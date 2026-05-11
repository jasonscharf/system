/**
 * Triple store integration tests.
 *
 * Per the project spec, every DB test runs against BOTH SQLite (always) and
 * Postgres (when TERN_PG_URL is set).  Each suite wraps its work in a
 * transaction that is rolled back after the suite so the schema stays clean.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Knex } from 'knex';
import { IRI, type BlankNode, type Literal, type Quad } from '@system/core';
import { createDataContext, TripleStore, type QuadPattern } from '@system/data';


// ── Helpers ───────────────────────────────────────────────────────────────────

function iri(value: string): IRI {
    return { value } as IRI;
}

function blank(id: string): BlankNode {
    return { termType: 'BlankNode', id };
}

function literal(value: string, datatypeIri?: string, lang?: string): Literal {
    return {
        termType: 'Literal',
        value,
        datatype: iri(datatypeIri ?? 'http://www.w3.org/2001/XMLSchema#string'),
        language: lang,
    };
}

const RDF_TYPE    = iri('http://www.w3.org/1999/02/22-rdf-syntax-ns#type');
const RDFS_LABEL  = iri('http://www.w3.org/2000/01/rdf-schema#label');
const OWL_THING   = iri('http://www.w3.org/2002/07/owl#Thing');
const EX          = (local: string) => iri(`http://example.org/${local}`);
const GRAPH       = EX('graph1');


// ── Provider matrix ───────────────────────────────────────────────────────────

interface Provider {
    name: string;
    create(): Promise<Knex>;
}

const providers: Provider[] = [
    {
        name: 'SQLite (in-memory)',
        create: () => createDataContext({ client: 'sqlite', filename: ':memory:' }),
    },
];

if (process.env['TERN_PG_URL']) {
    const url = new URL(process.env['TERN_PG_URL']);
    providers.push({
        name: 'Postgres',
        create: () => createDataContext({
            client:   'pg',
            host:     url.hostname,
            port:     url.port ? Number(url.port) : 5432,
            database: url.pathname.slice(1),
            user:     url.username,
            password: url.password,
        }),
    });
}


// ── Shared suite (runs once per provider) ─────────────────────────────────────

for (const provider of providers) {
    describe(`TripleStore — ${provider.name}`, () => {
        let knex: Knex;
        let store: TripleStore;
        let trx: Knex.Transaction;

        beforeEach(async () => {
            knex  = await provider.create();
            trx   = await knex.transaction();
            store = new TripleStore(trx as unknown as Knex);
        });

        afterEach(async () => {
            await trx.rollback();
            await knex.destroy();
        });

        // ── ensureNamespace ───────────────────────────────────────────────────

        it('registers a namespace and returns its id', async () => {
            const id = await store.ensureNamespace('ex', 'http://example.org/');
            expect(id).toBeGreaterThan(0);
        });

        it('returns the same id for a duplicate namespace', async () => {
            const a = await store.ensureNamespace('ex', 'http://example.org/');
            const b = await store.ensureNamespace('ex', 'http://example.org/');
            expect(a).toBe(b);
        });

        // ── ensureName ────────────────────────────────────────────────────────

        it('interns an IRI and returns its name id', async () => {
            const id = await store.ensureName('http://example.org/foo');
            expect(id).toBeGreaterThan(0);
        });

        it('interns the same IRI idempotently', async () => {
            const a = await store.ensureName('http://example.org/foo');
            const b = await store.ensureName('http://example.org/foo');
            expect(a).toBe(b);
        });

        // ── ensureNode ────────────────────────────────────────────────────────

        it('interns an IRI node', async () => {
            const id = await store.ensureNode(EX('subject'));
            expect(id).toBeGreaterThan(0);
        });

        it('interns the same IRI node idempotently', async () => {
            const a = await store.ensureNode(EX('subject'));
            const b = await store.ensureNode(EX('subject'));
            expect(a).toBe(b);
        });

        it('interns a blank node', async () => {
            const id = await store.ensureNode(blank('b0'));
            expect(id).toBeGreaterThan(0);
        });

        it('interns a string literal', async () => {
            const id = await store.ensureNode(literal('hello'));
            expect(id).toBeGreaterThan(0);
        });

        it('distinguishes literals with different language tags', async () => {
            const en = await store.ensureNode(literal('cat', undefined, 'en'));
            const fr = await store.ensureNode(literal('chat', undefined, 'fr'));
            expect(en).not.toBe(fr);
        });

        // ── insert / find ─────────────────────────────────────────────────────

        it('inserts a triple and finds it by subject', async () => {
            const q: Quad = { subject: EX('s'), predicate: RDF_TYPE, object: OWL_THING, graph: GRAPH };
            await store.insert(q);

            const found = await store.find({ subject: EX('s') });
            expect(found).toHaveLength(1);
            expect((found[0].subject as IRI).value).toBe('http://example.org/s');
            expect((found[0].predicate as IRI).value).toBe(RDF_TYPE.value);
        });

        it('inserts a triple and finds it by predicate', async () => {
            await store.insert({ subject: EX('a'), predicate: RDF_TYPE, object: OWL_THING, graph: GRAPH });
            await store.insert({ subject: EX('b'), predicate: RDFS_LABEL, object: literal('B'), graph: GRAPH });

            const byType = await store.find({ predicate: RDF_TYPE });
            expect(byType).toHaveLength(1);
            expect((byType[0].subject as IRI).value).toBe('http://example.org/a');
        });

        it('inserts a triple and finds it by object IRI', async () => {
            await store.insert({ subject: EX('a'), predicate: RDF_TYPE, object: OWL_THING, graph: GRAPH });

            const found = await store.find({ object: OWL_THING });
            expect(found).toHaveLength(1);
        });

        it('inserts a triple and finds it by literal object', async () => {
            const label = literal('hello world');
            await store.insert({ subject: EX('doc'), predicate: RDFS_LABEL, object: label, graph: GRAPH });

            const found = await store.find({ object: label });
            expect(found).toHaveLength(1);
            expect(((found[0].object) as Literal).value).toBe('hello world');
        });

        it('inserts a triple with a blank node subject', async () => {
            const b = blank('anon1');
            await store.insert({ subject: b, predicate: RDF_TYPE, object: OWL_THING, graph: GRAPH });

            const found = await store.find({ subject: b });
            expect(found).toHaveLength(1);
            expect((found[0].subject as BlankNode).termType).toBe('BlankNode');
            expect((found[0].subject as BlankNode).id).toBe('anon1');
        });

        it('de-duplicates identical quads on insert', async () => {
            const q: Quad = { subject: EX('s'), predicate: RDF_TYPE, object: OWL_THING, graph: GRAPH };
            await store.insert(q);
            await store.insert(q);  // should be ignored (onConflict ignore)

            const found = await store.find({ subject: EX('s') });
            expect(found).toHaveLength(1);
        });

        it('finds all triples when no pattern is given', async () => {
            await store.insertMany([
                { subject: EX('a'), predicate: RDF_TYPE,   object: OWL_THING,      graph: GRAPH },
                { subject: EX('b'), predicate: RDFS_LABEL, object: literal('B'),   graph: GRAPH },
                { subject: EX('c'), predicate: RDF_TYPE,   object: OWL_THING,      graph: GRAPH },
            ]);

            const all = await store.find();
            expect(all).toHaveLength(3);
        });

        it('returns empty array when subject not found', async () => {
            const found = await store.find({ subject: EX('ghost') });
            expect(found).toHaveLength(0);
        });

        // ── graph scoping ─────────────────────────────────────────────────────

        it('finds triples scoped to a specific graph', async () => {
            const g1 = EX('g1');
            const g2 = EX('g2');
            await store.insert({ subject: EX('s'), predicate: RDF_TYPE, object: OWL_THING, graph: g1 });
            await store.insert({ subject: EX('s'), predicate: RDF_TYPE, object: OWL_THING, graph: g2 });

            const inG1 = await store.find({ graph: g1 });
            expect(inG1).toHaveLength(1);
        });

        // ── delete ────────────────────────────────────────────────────────────

        it('deletes triples matching a pattern', async () => {
            await store.insert({ subject: EX('del'), predicate: RDF_TYPE, object: OWL_THING, graph: GRAPH });
            const deleted = await store.delete({ subject: EX('del') });
            expect(deleted).toBe(1);
            expect(await store.find({ subject: EX('del') })).toHaveLength(0);
        });

        it('returns 0 when delete pattern matches nothing', async () => {
            const deleted = await store.delete({ subject: EX('nobody') });
            expect(deleted).toBe(0);
        });

        it('deletes only matching triples, leaving others intact', async () => {
            await store.insertMany([
                { subject: EX('keep'),   predicate: RDF_TYPE, object: OWL_THING, graph: GRAPH },
                { subject: EX('remove'), predicate: RDF_TYPE, object: OWL_THING, graph: GRAPH },
            ]);
            await store.delete({ subject: EX('remove') });
            const all = await store.find();
            expect(all).toHaveLength(1);
            expect((all[0].subject as IRI).value).toBe('http://example.org/keep');
        });

        // ── stats ─────────────────────────────────────────────────────────────

        it('reports accurate stats after insertions', async () => {
            await store.insertMany([
                { subject: EX('a'), predicate: RDF_TYPE,   object: OWL_THING,    graph: GRAPH },
                { subject: EX('b'), predicate: RDFS_LABEL, object: literal('B'), graph: GRAPH },
            ]);
            const s = await store.stats();
            expect(s.edges).toBe(2);
            expect(s.nodes).toBeGreaterThanOrEqual(4); // a, b, rdf:type, rdfs:label, owl:Thing, lit
            expect(s.names).toBeGreaterThanOrEqual(3);
        });

        it('stats reflect deletions', async () => {
            await store.insert({ subject: EX('x'), predicate: RDF_TYPE, object: OWL_THING, graph: GRAPH });
            await store.delete({ subject: EX('x') });
            const s = await store.stats();
            expect(s.edges).toBe(0);
        });
    });
}
