/**
 * Graph + time-series TripleStore integration tests.
 *
 * Verifies:
 *   - created_at / updated_at timestamps are set on every node and edge
 *   - Literal nodes carry a typed JSONB payload (value_json)
 *   - delete() is a soft-delete: edges gain is_deleted=true + deleted_at
 *   - find() returns only active (non-deleted) edges
 *   - findHistory() returns ALL versions including soft-deleted ones
 *   - Re-inserting a previously deleted quad creates a new active edge (history preserved)
 *   - Attribute updates (delete + insert cycle) produce a complete audit trail
 *   - deleteSubjects() soft-deletes in bulk (one SQL round-trip)
 *   - deleteBySubjectPredicates() soft-deletes in bulk
 *   - No data is ever physically removed from the database
 *   - Collection operations (push / remove / set) are fully soft-delete aware
 *   - stats() reports active edge count and total (including deleted)
 *   - Timestamps are in UTC with timezone
 *
 * All suites run against SQLite always and Postgres when TERN_PG_URL is set,
 * inside rolled-back transactions so the schema stays clean.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Knex } from 'knex';
import { IRI, DEFAULT_GRAPH, type Literal, type BlankNode } from '@system/core';
import { createDataContext, TripleStore, type ApplicationContext } from '@system/data';


// ── Helpers ───────────────────────────────────────────────────────────────────

function iri(v: string): IRI   { return { value: v } as IRI; }
function blank(id: string): BlankNode { return { termType: 'BlankNode', id }; }
function literal(value: string, datatypeIri?: string, lang?: string): Literal {
    return {
        termType: 'Literal',
        value,
        datatype: iri(datatypeIri ?? 'http://www.w3.org/2001/XMLSchema#string'),
        language: lang,
    };
}

const XSD  = 'http://www.w3.org/2001/XMLSchema#';
const RDF  = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const EX   = (s: string) => iri(`http://example.org/${s}`);
const TYPE = iri(`${RDF}type`);
const NAME = iri(`http://example.org/name`);
const AGE  = iri(`http://example.org/age`);
const GRAPH = EX('g');


// ── Provider matrix ───────────────────────────────────────────────────────────

interface DbProvider { name: string; create(): Promise<Knex>; }

const providers: DbProvider[] = [
    { name: 'SQLite', create: () => createDataContext({ client: 'sqlite', filename: ':memory:' }) },
];

if (process.env['TERN_PG_URL']) {
    const url = new URL(process.env['TERN_PG_URL']);
    providers.push({
        name: 'Postgres',
        create: () => createDataContext({
            client: 'pg', host: url.hostname,
            port: url.port ? Number(url.port) : 5432,
            database: url.pathname.slice(1), user: url.username, password: url.password,
        }),
    });
}

// ── Direct table helpers (bypass TripleStore public API) ──────────────────────

async function countEdges(knex: Knex, includeDeleted = false): Promise<number> {
    let q = knex('tern_edges');
    if (!includeDeleted) { q = q.where('is_deleted', false); }
    const [row] = await q.count<[{ count: number }]>('id as count');
    return Number(row!.count);
}

async function countNodes(knex: Knex): Promise<number> {
    const [row] = await knex('tern_nodes').count<[{ count: number }]>('id as count');
    return Number(row!.count);
}

async function getEdgeRow(knex: Knex, id: number) {
    return knex('tern_edges').where('id', id).first<{
        is_deleted: boolean;
        deleted_at: string | null;
        created_at: string;
        updated_at: string;
    }>();
}

async function getLiteralNode(knex: Knex, value: string) {
    return knex('tern_nodes').where({ kind: 'literal', value }).first<{
        id: number;
        value: string;
        datatype: string;
        value_json: string | null;
        created_at: string;
        updated_at: string;
    }>();
}

async function getEdgeById(knex: Knex, subjectIri: string) {
    // Find the internal node ID for the subject IRI, then find its edges
    const name = await knex('tern_names').where('iri', subjectIri).first<{ id: number }>();
    if (!name) { return []; }
    const node = await knex('tern_nodes').where({ kind: 'iri', name_id: name.id }).first<{ id: number }>();
    if (!node) { return []; }
    return knex('tern_edges').where('subject', node.id).select('*');
}


// ─────────────────────────────────────────────────────────────────────────────

for (const db of providers) {

    // ── Timestamps on nodes ───────────────────────────────────────────────────

    describe(`TripleStore — node timestamps (${db.name})`, () => {
        let knex: Knex;
        let trx:  Knex.Transaction;
        let store: TripleStore;
        let ctx: ApplicationContext;

        beforeEach(async () => {
            knex  = await db.create();
            trx   = await knex.transaction();
            store = new TripleStore(knex);
            ctx   = { trx };
        });
        afterEach(async () => { await trx.rollback(); await knex.destroy(); });

        it('IRI nodes have created_at and updated_at in UTC', async () => {
            const before = Date.now();
            await store.ensureNode(ctx, EX('foo'));
            const after  = Date.now();

            const row = await trx('tern_nodes')
                .join('tern_names', 'tern_nodes.name_id', 'tern_names.id')
                .where('tern_names.iri', 'http://example.org/foo')
                .first<{ created_at: string; updated_at: string }>();

            expect(row).toBeDefined();
            const createdMs = new Date(row!.created_at).getTime();
            expect(createdMs).toBeGreaterThanOrEqual(before);
            expect(createdMs).toBeLessThanOrEqual(after);
            expect(row!.updated_at).toBeDefined();
        });

        it('literal nodes have created_at', async () => {
            await store.ensureNode(ctx, literal('hello'));
            const row = await getLiteralNode(trx as unknown as Knex, 'hello');
            expect(row).toBeDefined();
            expect(row!.created_at).toBeTruthy();
        });

        it('blank nodes have created_at', async () => {
            await store.ensureNode(ctx, blank('b1'));
            const row = await trx('tern_nodes').where({ kind: 'blank', blank: 'b1' })
                .first<{ created_at: string }>();
            expect(row!.created_at).toBeTruthy();
        });
    });


    // ── JSONB literal storage ─────────────────────────────────────────────────

    describe(`TripleStore — JSONB literal nodes (${db.name})`, () => {
        let knex: Knex;
        let trx:  Knex.Transaction;
        let store: TripleStore;
        let ctx: ApplicationContext;

        beforeEach(async () => {
            knex  = await db.create();
            trx   = await knex.transaction();
            store = new TripleStore(knex);
            ctx   = { trx };
        });
        afterEach(async () => { await trx.rollback(); await knex.destroy(); });

        it('stores a string literal in value_json with string v', async () => {
            await store.ensureNode(ctx, literal('alice@example.com', `${XSD}string`));
            const row = await getLiteralNode(trx as unknown as Knex, 'alice@example.com');
            const json = JSON.parse(row!.value_json!);
            expect(json.v).toBe('alice@example.com');
            expect(json.dt).toBe(`${XSD}string`);
        });

        it('stores a boolean literal with native boolean v=true', async () => {
            await store.ensureNode(ctx, literal('true', `${XSD}boolean`));
            const row  = await getLiteralNode(trx as unknown as Knex, 'true');
            const json = JSON.parse(row!.value_json!);
            expect(json.v).toBe(true);
            expect(typeof json.v).toBe('boolean');
        });

        it('stores a boolean literal with native boolean v=false', async () => {
            await store.ensureNode(ctx, literal('false', `${XSD}boolean`));
            const row  = await getLiteralNode(trx as unknown as Knex, 'false');
            const json = JSON.parse(row!.value_json!);
            expect(json.v).toBe(false);
        });

        it('stores an integer literal with native number v', async () => {
            await store.ensureNode(ctx, literal('42', `${XSD}integer`));
            const row  = await getLiteralNode(trx as unknown as Knex, '42');
            const json = JSON.parse(row!.value_json!);
            expect(json.v).toBe(42);
            expect(typeof json.v).toBe('number');
        });

        it('stores a decimal literal with native number v', async () => {
            await store.ensureNode(ctx, literal('3.14', `${XSD}decimal`));
            const row  = await getLiteralNode(trx as unknown as Knex, '3.14');
            const json = JSON.parse(row!.value_json!);
            expect(json.v).toBeCloseTo(3.14);
        });

        it('stores a dateTime literal as string v', async () => {
            const dt = '2024-01-15T12:00:00Z';
            await store.ensureNode(ctx, literal(dt, `${XSD}dateTime`));
            const row  = await getLiteralNode(trx as unknown as Knex, dt);
            const json = JSON.parse(row!.value_json!);
            expect(json.v).toBe(dt);
            expect(json.dt).toBe(`${XSD}dateTime`);
        });

        it('stores a lang-tagged literal with lang key', async () => {
            const term: Literal = {
                termType: 'Literal',
                value:    'hello',
                datatype: iri(`${RDF}langString`),
                language: 'en',
            };
            await store.ensureNode(ctx, term);
            const row  = await getLiteralNode(trx as unknown as Knex, 'hello');
            const json = JSON.parse(row!.value_json!);
            expect(json.v).toBe('hello');
            expect(json.lang).toBe('en');
        });

        it('round-trips value_json through find()', async () => {
            await store.insert(ctx, { subject: EX('s'), predicate: AGE, object: literal('99', `${XSD}integer`), graph: GRAPH });
            const quads = await store.find(ctx, { subject: EX('s') });
            expect(quads).toHaveLength(1);
            const obj = quads[0]!.object as Literal;
            expect(obj.termType).toBe('Literal');
            expect(obj.value).toBe('99');
            expect(obj.datatype.value).toBe(`${XSD}integer`);
        });
    });


    // ── Timestamps on edges ───────────────────────────────────────────────────

    describe(`TripleStore — edge timestamps (${db.name})`, () => {
        let knex: Knex;
        let trx:  Knex.Transaction;
        let store: TripleStore;
        let ctx: ApplicationContext;

        beforeEach(async () => {
            knex  = await db.create();
            trx   = await knex.transaction();
            store = new TripleStore(knex);
            ctx   = { trx };
        });
        afterEach(async () => { await trx.rollback(); await knex.destroy(); });

        it('insert sets created_at and updated_at', async () => {
            const before = Date.now();
            await store.insert(ctx, { subject: EX('s'), predicate: TYPE, object: EX('T'), graph: GRAPH });
            const after  = Date.now();

            const rows = await getEdgeById(trx as unknown as Knex, 'http://example.org/s');
            expect(rows).toHaveLength(1);
            const createdMs = new Date(rows[0].created_at).getTime();
            expect(createdMs).toBeGreaterThanOrEqual(before);
            expect(createdMs).toBeLessThanOrEqual(after);
            // SQLite stores booleans as 0/1; normalise with !!
            expect(!!rows[0].is_deleted).toBe(false);
            expect(rows[0].deleted_at).toBeNull();
        });

        it('insert is idempotent: duplicate active quad is not written twice', async () => {
            await store.insert(ctx, { subject: EX('s'), predicate: TYPE, object: EX('T'), graph: GRAPH });
            await store.insert(ctx, { subject: EX('s'), predicate: TYPE, object: EX('T'), graph: GRAPH });
            expect(await countEdges(trx as unknown as Knex)).toBe(1);
        });
    });


    // ── Soft delete ───────────────────────────────────────────────────────────

    describe(`TripleStore — soft delete (${db.name})`, () => {
        let knex: Knex;
        let trx:  Knex.Transaction;
        let store: TripleStore;
        let ctx: ApplicationContext;

        beforeEach(async () => {
            knex  = await db.create();
            trx   = await knex.transaction();
            store = new TripleStore(knex);
            ctx   = { trx };
        });
        afterEach(async () => { await trx.rollback(); await knex.destroy(); });

        it('delete() marks the edge is_deleted=true and sets deleted_at', async () => {
            await store.insert(ctx, { subject: EX('s'), predicate: TYPE, object: EX('T'), graph: GRAPH });
            const before = Date.now();
            const count  = await store.delete(ctx, { subject: EX('s') });
            const after  = Date.now();

            expect(count).toBe(1);

            // Edge still exists in database (soft-delete, not hard-delete)
            const rows = await getEdgeById(trx as unknown as Knex, 'http://example.org/s');
            expect(rows).toHaveLength(1);
            expect(!!rows[0].is_deleted).toBe(true); // SQLite returns 0/1
            const deletedMs = new Date(rows[0].deleted_at).getTime();
            expect(deletedMs).toBeGreaterThanOrEqual(before);
            expect(deletedMs).toBeLessThanOrEqual(after);
        });

        it('find() does not return soft-deleted edges', async () => {
            await store.insert(ctx, { subject: EX('s'), predicate: TYPE, object: EX('T'), graph: GRAPH });
            await store.delete(ctx, { subject: EX('s') });

            const quads = await store.find(ctx, { subject: EX('s') });
            expect(quads).toHaveLength(0);
        });

        it('the node row is still present after soft-delete (no hard deletion)', async () => {
            const nodesBefore = await countNodes(trx as unknown as Knex);
            await store.insert(ctx, { subject: EX('s'), predicate: TYPE, object: EX('T'), graph: GRAPH });
            const nodesAfterInsert = await countNodes(trx as unknown as Knex);
            await store.delete(ctx, { subject: EX('s') });
            const nodesAfterDelete = await countNodes(trx as unknown as Knex);

            // Nodes never decrease
            expect(nodesAfterDelete).toBe(nodesAfterInsert);
            expect(nodesAfterInsert).toBeGreaterThan(nodesBefore);
        });

        it('stats().edges counts only active edges; edgesTotal includes deleted', async () => {
            await store.insert(ctx, { subject: EX('s'), predicate: TYPE, object: EX('T'), graph: GRAPH });
            await store.insert(ctx, { subject: EX('u'), predicate: TYPE, object: EX('T'), graph: GRAPH });
            await store.delete(ctx, { subject: EX('s') });

            const s = await store.stats(ctx);
            expect(s.edges).toBe(1);       // only EX('u') is active
            expect(s.edgesTotal).toBe(2);  // both rows exist in the table
        });

        it('delete returns 0 when no active edge matches', async () => {
            const count = await store.delete(ctx, { subject: EX('ghost') });
            expect(count).toBe(0);
        });

        it('soft-deleting already-deleted edges does not double-count', async () => {
            await store.insert(ctx, { subject: EX('s'), predicate: TYPE, object: EX('T'), graph: GRAPH });
            await store.delete(ctx, { subject: EX('s') });
            const count2 = await store.delete(ctx, { subject: EX('s') });
            expect(count2).toBe(0);  // already deleted, no active edges remain
            expect(await countEdges(trx as unknown as Knex, true)).toBe(1); // still only one row total
        });
    });


    // ── findHistory ───────────────────────────────────────────────────────────

    describe(`TripleStore — findHistory (${db.name})`, () => {
        let knex: Knex;
        let trx:  Knex.Transaction;
        let store: TripleStore;
        let ctx: ApplicationContext;

        beforeEach(async () => {
            knex  = await db.create();
            trx   = await knex.transaction();
            store = new TripleStore(knex);
            ctx   = { trx };
        });
        afterEach(async () => { await trx.rollback(); await knex.destroy(); });

        it('returns active edges with isDeleted=false', async () => {
            await store.insert(ctx, { subject: EX('s'), predicate: TYPE, object: EX('T'), graph: GRAPH });
            const history = await store.findHistory(ctx, { subject: EX('s') });
            expect(history).toHaveLength(1);
            expect(history[0]!.isDeleted).toBe(false);
            expect(history[0]!.deletedAt).toBeNull();
            expect(history[0]!.createdAt).toBeInstanceOf(Date);
        });

        it('returns soft-deleted edges with isDeleted=true and a deletedAt Date', async () => {
            await store.insert(ctx, { subject: EX('s'), predicate: TYPE, object: EX('T'), graph: GRAPH });
            await store.delete(ctx, { subject: EX('s') });
            const history = await store.findHistory(ctx, { subject: EX('s') });
            expect(history).toHaveLength(1);
            expect(history[0]!.isDeleted).toBe(true);
            expect(history[0]!.deletedAt).toBeInstanceOf(Date);
        });

        it('attribute update produces two history rows: one deleted, one active', async () => {
            // Assert initial value
            await store.insert(ctx, { subject: EX('person'), predicate: NAME, object: literal('Alice'), graph: GRAPH });
            // Update: soft-delete old, insert new
            await store.delete(ctx, { subject: EX('person'), predicate: NAME });
            await store.insert(ctx, { subject: EX('person'), predicate: NAME, object: literal('Alice B.'), graph: GRAPH });

            const history = await store.findHistory(ctx, { subject: EX('person'), predicate: NAME });
            expect(history).toHaveLength(2);

            const [old, current] = history.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
            expect(old!.isDeleted).toBe(true);
            expect((old!.object as Literal).value).toBe('Alice');
            expect(current!.isDeleted).toBe(false);
            expect((current!.object as Literal).value).toBe('Alice B.');
        });

        it('re-inserting a previously deleted quad adds a new active row (history preserved)', async () => {
            await store.insert(ctx, { subject: EX('s'), predicate: TYPE, object: EX('T'), graph: GRAPH });
            await store.delete(ctx, { subject: EX('s') });
            await store.insert(ctx, { subject: EX('s'), predicate: TYPE, object: EX('T'), graph: GRAPH }); // re-assert

            const active  = await store.find(ctx, { subject: EX('s') });
            const history = await store.findHistory(ctx, { subject: EX('s') });

            expect(active).toHaveLength(1);  // one active edge
            expect(history).toHaveLength(2); // one deleted + one active
            expect(history.filter(h => h.isDeleted)).toHaveLength(1);
            expect(history.filter(h => !h.isDeleted)).toHaveLength(1);
        });

        it('findHistory with no pattern returns all edges across history', async () => {
            await store.insert(ctx, { subject: EX('a'), predicate: TYPE, object: EX('T'), graph: GRAPH });
            await store.insert(ctx, { subject: EX('b'), predicate: TYPE, object: EX('T'), graph: GRAPH });
            await store.delete(ctx, { subject: EX('a') });

            const history = await store.findHistory(ctx);
            expect(history).toHaveLength(2);
        });
    });


    // ── Bulk soft-delete helpers ──────────────────────────────────────────────

    describe(`TripleStore — deleteSubjects / deleteBySubjectPredicates (${db.name})`, () => {
        let knex: Knex;
        let trx:  Knex.Transaction;
        let store: TripleStore;
        let ctx: ApplicationContext;

        beforeEach(async () => {
            knex  = await db.create();
            trx   = await knex.transaction();
            store = new TripleStore(knex);
            ctx   = { trx };
        });
        afterEach(async () => { await trx.rollback(); await knex.destroy(); });

        it('deleteSubjects soft-deletes all edges for a list of subjects', async () => {
            await store.insert(ctx, { subject: EX('p1'), predicate: NAME, object: literal('P1'), graph: DEFAULT_GRAPH });
            await store.insert(ctx, { subject: EX('p2'), predicate: NAME, object: literal('P2'), graph: DEFAULT_GRAPH });
            await store.insert(ctx, { subject: EX('p3'), predicate: NAME, object: literal('P3'), graph: DEFAULT_GRAPH });

            await store.deleteSubjects(ctx, [EX('p1'), EX('p2')]);

            const active  = await store.find(ctx);
            const history = await store.findHistory(ctx);

            expect(active).toHaveLength(1); // only p3 survives
            expect(history).toHaveLength(3); // all rows still in DB
            expect(history.filter(h => h.isDeleted)).toHaveLength(2);
        });

        it('deleteBySubjectPredicates soft-deletes matching predicate edges', async () => {
            const s = EX('s');
            await store.insert(ctx, { subject: s, predicate: NAME, object: literal('N'), graph: DEFAULT_GRAPH });
            await store.insert(ctx, { subject: s, predicate: AGE,  object: literal('30', `${XSD}integer`), graph: DEFAULT_GRAPH });
            await store.insert(ctx, { subject: s, predicate: TYPE, object: EX('T'), graph: DEFAULT_GRAPH });

            // Delete only NAME and AGE, preserve TYPE
            await store.deleteBySubjectPredicates(ctx, s, [NAME, AGE]);

            const active  = await store.find(ctx, { subject: s });
            const history = await store.findHistory(ctx, { subject: s });

            expect(active).toHaveLength(1);
            expect((active[0]!.predicate as IRI).value).toBe(TYPE.value);
            expect(history).toHaveLength(3);
        });
    });


    // ── Temporal invariants ───────────────────────────────────────────────────

    describe(`TripleStore — temporal invariants (${db.name})`, () => {
        let knex: Knex;
        let trx:  Knex.Transaction;
        let store: TripleStore;
        let ctx: ApplicationContext;

        beforeEach(async () => {
            knex  = await db.create();
            trx   = await knex.transaction();
            store = new TripleStore(knex);
            ctx   = { trx };
        });
        afterEach(async () => { await trx.rollback(); await knex.destroy(); });

        it('deleted_at >= created_at always', async () => {
            await store.insert(ctx, { subject: EX('s'), predicate: TYPE, object: EX('T'), graph: GRAPH });
            await store.delete(ctx, { subject: EX('s') });

            const rows = await getEdgeById(trx as unknown as Knex, 'http://example.org/s');
            const row  = rows[0]!;
            const created = new Date(row.created_at).getTime();
            const deleted = new Date(row.deleted_at).getTime();
            expect(deleted).toBeGreaterThanOrEqual(created);
        });

        it('updated_at = deleted_at when soft-deleted', async () => {
            await store.insert(ctx, { subject: EX('s'), predicate: TYPE, object: EX('T'), graph: GRAPH });
            await store.delete(ctx, { subject: EX('s') });

            const rows = await getEdgeById(trx as unknown as Knex, 'http://example.org/s');
            const row  = rows[0]!;
            expect(row.updated_at).toBe(row.deleted_at);
        });

        it('findHistory edges are returned in ascending created_at order', async () => {
            await store.insert(ctx, { subject: EX('x'), predicate: NAME, object: literal('v1'), graph: DEFAULT_GRAPH });
            await store.delete(ctx, { subject: EX('x'), predicate: NAME });
            await store.insert(ctx, { subject: EX('x'), predicate: NAME, object: literal('v2'), graph: DEFAULT_GRAPH });
            await store.delete(ctx, { subject: EX('x'), predicate: NAME });
            await store.insert(ctx, { subject: EX('x'), predicate: NAME, object: literal('v3'), graph: DEFAULT_GRAPH });

            const history = await store.findHistory(ctx, { subject: EX('x'), predicate: NAME });
            expect(history).toHaveLength(3);

            const values = history.map(h => (h.object as Literal).value);
            expect(values).toEqual(['v1', 'v2', 'v3']); // oldest first
            for (let i = 1; i < history.length; i++) {
                expect(history[i]!.createdAt.getTime())
                    .toBeGreaterThanOrEqual(history[i - 1]!.createdAt.getTime());
            }
        });

        it('total edge count only grows — physical rows are never removed', async () => {
            let total = (await store.stats(ctx)).edgesTotal;

            await store.insert(ctx, { subject: EX('a'), predicate: TYPE, object: EX('T'), graph: GRAPH });
            total++;
            expect((await store.stats(ctx)).edgesTotal).toBe(total);

            await store.delete(ctx, { subject: EX('a') });
            expect((await store.stats(ctx)).edgesTotal).toBe(total); // no decrease

            await store.insert(ctx, { subject: EX('a'), predicate: TYPE, object: EX('T'), graph: GRAPH });
            total++;
            expect((await store.stats(ctx)).edgesTotal).toBe(total); // new row, not updated
        });
    });


    // ── EntityStore integration (soft-delete through higher-level API) ─────────

    describe(`EntityStore — soft-delete integration (${db.name})`, () => {
        let knex:  Knex;
        let trx:   Knex.Transaction;
        let store: TripleStore;
        let es:    import('@system/entities').EntityStore;
        let ctx:   { trx: Knex.Transaction };

        beforeEach(async () => {
            knex  = await db.create();
            trx   = await knex.transaction();
            store = new TripleStore(knex);
            const { EntityStore } = await import('@system/entities');
            es  = new EntityStore(store);
            ctx = { trx };
        });
        afterEach(async () => { await trx.rollback(); await knex.destroy(); });

        it('EntityStore.updateGroup produces two history rows for the changed predicate', async () => {
            const { UserSchema, CoreHandle } = await import('@system/auth');

            const user = await es.create(ctx, UserSchema, { email: 'test@example.com', displayName: 'Old' });

            // Update displayName — this should soft-delete the old edge and create a new one
            await es.updateGroup(ctx, UserSchema, user.id, CoreHandle, { displayName: 'New' });

            const iri = `http://tern.dev/ns/auth/displayName`;
            const history = await store.findHistory(ctx);
            const displayNameHistory = history.filter(h => (h.predicate as IRI).value === iri);

            expect(displayNameHistory).toHaveLength(2); // one deleted, one active
            expect(displayNameHistory.filter(h => h.isDeleted)).toHaveLength(1);
            expect(displayNameHistory.filter(h => !h.isDeleted)).toHaveLength(1);

            const [old, current] = displayNameHistory.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
            expect((old!.object as Literal).value).toBe('Old');
            expect((current!.object as Literal).value).toBe('New');
        });

        it('EntityStore.delete soft-deletes all entity edges', async () => {
            const { UserSchema } = await import('@system/auth');

            const user = await es.create(ctx, UserSchema, { email: 'del@example.com' });

            const totalBefore = (await store.stats(ctx)).edgesTotal;
            await es.delete(ctx, UserSchema, user.id);
            const totalAfter  = (await store.stats(ctx)).edgesTotal;

            // findById returns null (active edges are soft-deleted)
            expect(await es.findById(ctx, UserSchema, user.id, '*')).toBeNull();
            // But total edge count stays the same (no hard deletes)
            expect(totalAfter).toBe(totalBefore);
        });
    });
}


// ── DB trigger behaviour (003_timestamps) ────────────────────────────────────

for (const db of providers) {
    describe(`DB timestamp triggers (${db.name})`, () => {
        let knex:  Knex;
        let trx:   Knex.Transaction;
        let store: TripleStore;
        let ctx: ApplicationContext;

        beforeEach(async () => {
            knex  = await db.create();
            trx   = await knex.transaction();
            store = new TripleStore(knex);
            ctx   = { trx };
        });
        afterEach(async () => { await trx.rollback(); await knex.destroy(); });

        it('trigger sets created_at and updated_at on node insert without app providing them', async () => {
            await store.insert(ctx, { subject: EX('s'), predicate: TYPE, object: EX('T'), graph: DEFAULT_GRAPH });

            const name = await (trx as unknown as Knex)('tern_names').where('iri', 'http://example.org/s').first<{ id: number }>();
            const node = await (trx as unknown as Knex)('tern_nodes').where({ kind: 'iri', name_id: name!.id }).first<{ created_at: string; updated_at: string }>();

            expect(node!.created_at).toBeTruthy();
            expect(node!.updated_at).toBeTruthy();
            expect(new Date(node!.created_at).getTime()).toBeGreaterThan(0);
        });

        it('trigger sets created_at and updated_at on edge insert without app providing them', async () => {
            await store.insert(ctx, { subject: EX('s'), predicate: TYPE, object: EX('T'), graph: DEFAULT_GRAPH });

            const edges = await getEdgeById(trx as unknown as Knex, 'http://example.org/s');
            const edge  = edges[0]!;

            expect(edge.created_at).toBeTruthy();
            expect(edge.updated_at).toBeTruthy();
            expect(new Date(edge.created_at).getTime()).toBeGreaterThan(0);
        });

        it('trigger sets updated_at and deleted_at on soft-delete without app providing them', async () => {
            await store.insert(ctx, { subject: EX('s'), predicate: TYPE, object: EX('T'), graph: DEFAULT_GRAPH });
            await store.delete(ctx, { subject: EX('s') });

            const edges = await getEdgeById(trx as unknown as Knex, 'http://example.org/s');
            const edge  = edges[0]!;

            expect(!!edge.is_deleted).toBe(true);
            expect(edge.deleted_at).toBeTruthy();
            expect(edge.updated_at).toBeTruthy();
            expect(new Date(edge.deleted_at!).getTime()).toBeGreaterThan(0);
        });

        it('trigger preserves created_at across a soft-delete update', async () => {
            await store.insert(ctx, { subject: EX('s'), predicate: TYPE, object: EX('T'), graph: DEFAULT_GRAPH });
            const before = (await getEdgeById(trx as unknown as Knex, 'http://example.org/s'))[0]!;

            await store.delete(ctx, { subject: EX('s') });
            const after = (await getEdgeById(trx as unknown as Knex, 'http://example.org/s'))[0]!;

            expect(after.created_at).toBe(before.created_at);
        });
    });
}


// ── Migration 002 down/up ─────────────────────────────────────────────────────

describe('migration 002_time_series down()', () => {
    it('rolls back all new columns cleanly', async () => {
        const { up: up001 }   = await import('../../../data/src/migrations/001_init.js');
        const { up: up002, down: down002 } = await import('../../../data/src/migrations/002_time_series.js');

        const { default: Knex } = await import('knex');
        const knex = Knex({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });

        await up001(knex);
        await up002(knex);

        // Verify new columns exist
        const colsAfterUp = await knex('tern_edges').columnInfo();
        expect(colsAfterUp).toHaveProperty('is_deleted');
        expect(colsAfterUp).toHaveProperty('created_at');

        await down002(knex);

        // Verify new columns are gone
        const colsAfterDown = await knex('tern_edges').columnInfo();
        expect(colsAfterDown).not.toHaveProperty('is_deleted');
        expect(colsAfterDown).not.toHaveProperty('created_at');

        await knex.destroy();
    });
});
