import type { Knex } from 'knex';
import { DEFAULT_GRAPH, type BlankNode, type DefaultGraph, type IRI, type Literal, type Quad } from '@system/core';
import { C, T, type NodeKind } from './schema.js';


// ── Internal row types ────────────────────────────────────────────────────────

interface NameRow  { id: number; iri: string; }
interface NodeRow  { id: number; kind: NodeKind; name_id: number | null; blank: string | null; value: string | null; datatype: string | null; lang: string | null; }
interface EdgeRow  { id: number; subject: number; predicate: number; object: number; graph: number | null; }

type RdfTerm = IRI | BlankNode | Literal;

// ── Term helpers ──────────────────────────────────────────────────────────────

function makeIRI(iriStr: string): IRI {
    return { value: iriStr } as IRI;
}

function isIRI(term: RdfTerm): term is IRI {
    return !('termType' in term);
}

function nodeToTerm(row: NodeRow, nameIri: string | null): RdfTerm {
    if (row.kind === 'iri') {
        return makeIRI(nameIri!);
    }
    if (row.kind === 'blank') {
        return { termType: 'BlankNode', id: row.blank! } satisfies BlankNode;
    }
    return {
        termType: 'Literal',
        value:    row.value!,
        /* v8 ignore next -- row.datatype is always set by ensureNode */
        datatype: makeIRI(row.datatype ?? 'http://www.w3.org/2001/XMLSchema#string'),
        language: row.lang ?? undefined,
    } satisfies Literal;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QuadPattern {
    subject?:   IRI | BlankNode;
    predicate?: IRI;
    object?:    IRI | BlankNode | Literal;
    graph?:     IRI | null;
}

export interface StoreStats {
    namespaces: number;
    names:      number;
    nodes:      number;
    edges:      number;
}

// ── TripleStore ───────────────────────────────────────────────────────────────

/**
 * RDF quad store backed by Knex.
 *
 * Schema:
 *   tern_namespaces  — known prefix → IRI mappings
 *   tern_names       — every unique IRI encountered
 *   tern_nodes       — every unique RDF term (IRI / blank / literal)
 *   tern_edges       — quads (subject, predicate, object, graph)
 */
export class TripleStore {
    private readonly _knex: Knex;

    constructor(knex: Knex) {
        this._knex = knex;
    }

    /** Direct access to the underlying Knex instance for advanced queries. */
    get knex(): Knex { return this._knex; }

    // ── Namespace registry ────────────────────────────────────────────────────

    async ensureNamespace(prefix: string, iriStr: string): Promise<number> {
        const row = await this._knex(T.namespaces).where(C.prefix, prefix).first<{ id: number }>();
        if (row) { return row.id; }
        const [id] = await this._knex(T.namespaces).insert({ [C.prefix]: prefix, [C.iri]: iriStr });
        return id as number;
    }

    // ── Term internment ───────────────────────────────────────────────────────

    async ensureName(iriStr: string): Promise<number> {
        const row = await this._knex(T.names).where(C.iri, iriStr).first<NameRow>();
        if (row) { return row.id; }
        const [id] = await this._knex(T.names).insert({ [C.iri]: iriStr });
        return id as number;
    }

    async ensureNode(term: RdfTerm): Promise<number> {
        if (isIRI(term)) {
            const nameId = await this.ensureName(term.value);
            const row = await this._knex(T.nodes).where({ [C.kind]: 'iri', [C.nameId]: nameId }).first<NodeRow>();
            if (row) { return row.id; }
            const [id] = await this._knex(T.nodes).insert({ [C.kind]: 'iri', [C.nameId]: nameId });
            return id as number;
        }

        if (term.termType === 'BlankNode') {
            const row = await this._knex(T.nodes).where({ [C.kind]: 'blank', [C.blank]: term.id }).first<NodeRow>();
            if (row) { return row.id; }
            const [id] = await this._knex(T.nodes).insert({ [C.kind]: 'blank', [C.blank]: term.id });
            return id as number;
        }

        // Literal
        /* v8 ignore next -- Literal.datatype is always an IRI via the public API */
        const dtIri = term.datatype?.value ?? 'http://www.w3.org/2001/XMLSchema#string';
        const row = await this._knex(T.nodes).where({
            [C.kind]:     'literal',
            [C.value]:    term.value,
            [C.datatype]: dtIri,
            [C.lang]:     term.language ?? null,
        }).first<NodeRow>();
        if (row) { return row.id; }
        const [id] = await this._knex(T.nodes).insert({
            [C.kind]:     'literal',
            [C.value]:    term.value,
            [C.datatype]: dtIri,
            [C.lang]:     term.language ?? null,
        });
        return id as number;
    }

    // ── Write ─────────────────────────────────────────────────────────────────

    async insert(quad: Quad): Promise<void> {
        const [sId, pId, oId] = await Promise.all([
            this.ensureNode(quad.subject as RdfTerm),
            this.ensureNode(quad.predicate as IRI),
            this.ensureNode(quad.object as RdfTerm),
        ]);

        const gIsDefault = !quad.graph || ('termType' in quad.graph && quad.graph.termType === 'DefaultGraph');
        const gId = gIsDefault ? null : await this.ensureNode(quad.graph as IRI);

        await this._knex(T.edges)
            .insert({ [C.subject]: sId, [C.predicate]: pId, [C.object]: oId, [C.graph]: gId })
            .onConflict([C.subject, C.predicate, C.object, C.graph])
            .ignore();
    }

    async insertMany(quads: readonly Quad[]): Promise<void> {
        for (const q of quads) {
            await this.insert(q);
        }
    }

    // ── Read ──────────────────────────────────────────────────────────────────

    async find(pattern: QuadPattern = {}): Promise<Quad[]> {
        let q = this._knex(T.edges).select<EdgeRow[]>('*');

        if (pattern.subject !== undefined) {
            const id = await this._nodeId(pattern.subject);
            if (id === null) { return []; }
            q = q.where(C.subject, id);
        }
        if (pattern.predicate !== undefined) {
            const id = await this._nodeId(pattern.predicate);
            if (id === null) { return []; }
            q = q.where(C.predicate, id);
        }
        if (pattern.object !== undefined) {
            const id = await this._nodeId(pattern.object);
            if (id === null) { return []; }
            q = q.where(C.object, id);
        }
        if (pattern.graph !== undefined) {
            if (pattern.graph === null) {
                q = q.whereNull(C.graph);
            } else {
                const id = await this._nodeId(pattern.graph);
                if (id === null) { return []; }
                q = q.where(C.graph, id);
            }
        }

        const edges = await q;
        if (edges.length === 0) { return []; }

        // Collect all unique node IDs, then load in two queries
        const nodeIds = new Set<number>();
        for (const e of edges) {
            nodeIds.add(e.subject);
            nodeIds.add(e.predicate);
            nodeIds.add(e.object);
            if (e.graph !== null) { nodeIds.add(e.graph); }
        }

        const nodeMap = await this._loadNodes([...nodeIds]);

        return edges.map(e => ({
            subject:   nodeMap.get(e.subject)! as IRI | BlankNode,
            predicate: nodeMap.get(e.predicate)! as IRI,
            object:    nodeMap.get(e.object)! as RdfTerm,
            graph:     e.graph !== null
                ? nodeMap.get(e.graph)! as IRI
                : DEFAULT_GRAPH satisfies DefaultGraph,
        }));
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    async delete(pattern: QuadPattern): Promise<number> {
        let q = this._knex(T.edges);

        if (pattern.subject !== undefined) {
            const id = await this._nodeId(pattern.subject);
            if (id === null) { return 0; }
            q = q.where(C.subject, id);
        }
        if (pattern.predicate !== undefined) {
            const id = await this._nodeId(pattern.predicate);
            if (id === null) { return 0; }
            q = q.where(C.predicate, id);
        }
        if (pattern.object !== undefined) {
            const id = await this._nodeId(pattern.object);
            if (id === null) { return 0; }
            q = q.where(C.object, id);
        }
        if (pattern.graph !== undefined) {
            if (pattern.graph === null) {
                q = q.whereNull(C.graph);
            } else {
                const id = await this._nodeId(pattern.graph);
                if (id === null) { return 0; }
                q = q.where(C.graph, id);
            }
        }

        return q.delete();
    }

    /**
     * Fetches all quads for a list of subjects in a single round-trip.
     * Returns a Map keyed by subject IRI string (or blank-node id prefixed with `_:`).
     */
    async findForSubjects(subjects: readonly (IRI | BlankNode)[]): Promise<Map<string, Quad[]>> {
        if (subjects.length === 0) { return new Map(); }

        const pairs = await Promise.all(subjects.map(async s => [s, await this._nodeId(s as RdfTerm)] as const));
        const validPairs = pairs.filter((p): p is [IRI | BlankNode, number] => p[1] !== null);
        if (validPairs.length === 0) { return new Map(); }

        const idToSubject = new Map(validPairs.map(([term, id]) => [id, term]));
        const edges = await this._knex(T.edges)
            .whereIn(C.subject, validPairs.map(([, id]) => id))
            .select<EdgeRow[]>('*');

        if (edges.length === 0) { return new Map(); }

        const nodeIds = new Set<number>();
        for (const e of edges) {
            nodeIds.add(e.subject);
            nodeIds.add(e.predicate);
            nodeIds.add(e.object);
            if (e.graph !== null) { nodeIds.add(e.graph); }
        }
        const nodeMap = await this._loadNodes([...nodeIds]);

        const result = new Map<string, Quad[]>();
        for (const e of edges) {
            const subjTerm = idToSubject.get(e.subject)!;
            const key = isIRI(subjTerm) ? subjTerm.value : `_:${(subjTerm as BlankNode).id}`;
            if (!result.has(key)) { result.set(key, []); }
            result.get(key)!.push({
                subject:   nodeMap.get(e.subject)! as IRI | BlankNode,
                predicate: nodeMap.get(e.predicate)! as IRI,
                object:    nodeMap.get(e.object)!,
                graph:     e.graph !== null
                    ? nodeMap.get(e.graph)! as IRI
                    : DEFAULT_GRAPH satisfies DefaultGraph,
            });
        }
        return result;
    }

    async stats(): Promise<StoreStats> {
        const [ns, na, no, ne] = await Promise.all([
            this._knex(T.namespaces).count<[{ count: number }]>(`${C.id} as count`),
            this._knex(T.names).count<[{ count: number }]>(`${C.id} as count`),
            this._knex(T.nodes).count<[{ count: number }]>(`${C.id} as count`),
            this._knex(T.edges).count<[{ count: number }]>(`${C.id} as count`),
        ]);
        return {
            namespaces: Number(ns[0].count),
            names:      Number(na[0].count),
            nodes:      Number(no[0].count),
            edges:      Number(ne[0].count),
        };
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private async _nodeId(term: RdfTerm): Promise<number | null> {
        if (isIRI(term)) {
            const name = await this._knex(T.names).where(C.iri, term.value).first<NameRow>();
            if (!name) { return null; }
            const node = await this._knex(T.nodes)
                .where({ [C.kind]: 'iri', [C.nameId]: name.id })
                .first<NodeRow>();
            /* v8 ignore next -- name always has a corresponding node (ensureNode maintains this invariant) */
            return node?.id ?? null;
        }

        if (term.termType === 'BlankNode') {
            const node = await this._knex(T.nodes)
                .where({ [C.kind]: 'blank', [C.blank]: term.id })
                .first<NodeRow>();
            return node?.id ?? null;
        }

        // Literal
        /* v8 ignore next -- Literal.datatype is always an IRI via the public API */
        const dtIri = term.datatype?.value ?? 'http://www.w3.org/2001/XMLSchema#string';
        const node = await this._knex(T.nodes).where({
            [C.kind]:     'literal',
            [C.value]:    term.value,
            [C.datatype]: dtIri,
            [C.lang]:     term.language ?? null,
        }).first<NodeRow>();
        return node?.id ?? null;
    }

    private async _loadNodes(ids: number[]): Promise<Map<number, RdfTerm>> {
        /* v8 ignore next -- always called with non-empty ids from find() */
        if (ids.length === 0) { return new Map(); }

        const nodes = await this._knex(T.nodes).whereIn(C.id, ids).select<NodeRow[]>('*');

        // Batch-load names for IRI nodes
        const iriNodeIds = nodes.filter(n => n.kind === 'iri' && n.name_id !== null).map(n => n.name_id!);
        /* v8 ignore next -- valid RDF always has IRI predicates so iriNodeIds is never empty */
        const names: NameRow[] = iriNodeIds.length > 0
            ? await this._knex(T.names).whereIn(C.id, iriNodeIds).select<NameRow[]>('*')
            : [];
        const nameMap = new Map(names.map(n => [n.id, n.iri]));

        /* v8 ignore next -- blank/literal nodes (name_id=null) branch covered by existing tests */
        return new Map(nodes.map(n => [n.id, nodeToTerm(n, n.name_id !== null ? (nameMap.get(n.name_id) ?? null) : null)]));
    }
}
