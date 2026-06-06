import {
    type ApplicationContext,
    type BlankNode,
    DEFAULT_GRAPH,
    type DefaultGraph,
    type IRI,
    type Literal,
    type Quad,
} from "@jasonscharf/core";
import type { Knex } from "knex";
import { coerceLiteralValue } from "./migrations/002_time_series.js";
import { C, type LiteralJson, type NodeKind, T } from "./schema.js";

interface ServerContext extends ApplicationContext {
    trx?: Knex.Transaction;
}

// ── Internal row types ────────────────────────────────────────────────────────

interface NameRow {
    id: number;
    iri: string;
}
interface NodeRow {
    id: number;
    kind: NodeKind;
    name_id: number | null;
    blank: string | null;
    value: string | null;
    datatype: string | null;
    lang: string | null;
    /** JSONB payload for literal nodes.  May be an object (Postgres) or JSON string (SQLite). */
    value_json: LiteralJson | string | null;
    created_at: string;
    updated_at: string;
}
interface EdgeRow {
    id: number;
    subject: number;
    predicate: number;
    object: number;
    graph: number | null;
    created_at: string;
    updated_at: string;
    is_deleted: boolean;
    deleted_at: string | null;
}

type RdfTerm = IRI | BlankNode | Literal;

// ── Literal JSONB helpers ─────────────────────────────────────────────────────

function makeLiteralJson(value: string, datatypeIri: string, language?: string): LiteralJson {
    const json: LiteralJson = { v: coerceLiteralValue(value, datatypeIri), dt: datatypeIri };
    if (language) {
        json.lang = language;
    }
    return json;
}

function parseLiteralJson(raw: LiteralJson | string | null): LiteralJson | null {
    if (!raw) {
        return null;
    }
    if (typeof raw === "string") {
        return JSON.parse(raw) as LiteralJson;
    }
    /* c8 ignore next -- Postgres returns JSONB as a pre-parsed object; SQLite always returns a string */
    return raw;
}

// ── Term helpers ──────────────────────────────────────────────────────────────

function makeIRI(iriStr: string): IRI {
    return { value: iriStr } as IRI;
}

function isIRI(term: RdfTerm): term is IRI {
    return !("termType" in term);
}

function nodeToTerm(row: NodeRow, nameIri: string | null): RdfTerm {
    if (row.kind === "iri") {
        if (nameIri == null) {
            throw new Error("nodeToTerm: nameIri must not be null for IRI node");
        }
        return makeIRI(nameIri);
    }
    if (row.kind === "blank") {
        if (row.blank == null) {
            throw new Error("nodeToTerm: blank must not be null for blank node");
        }
        return { termType: "BlankNode", id: row.blank } satisfies BlankNode;
    }

    // Literal — prefer the typed JSONB payload when present
    const json = parseLiteralJson(row.value_json);
    if (json) {
        return {
            termType: "Literal",
            value: String(json.v),
            datatype: makeIRI(json.dt),
            language: json.lang ?? undefined,
        } satisfies Literal;
    }

    // Fallback: legacy value / datatype / lang columns (pre-migration rows)
    /* v8 ignore next -- row.datatype is always set by ensureNode */
    const dtIri = row.datatype ?? "http://www.w3.org/2001/XMLSchema#string";
    if (row.value == null) {
        throw new Error("nodeToTerm: value must not be null for literal node");
    }
    return {
        termType: "Literal",
        value: row.value,
        datatype: makeIRI(dtIri),
        language: row.lang ?? undefined,
    } satisfies Literal;
}

// ── Public API types ──────────────────────────────────────────────────────────

export interface QuadPattern {
    subject?: IRI | BlankNode;
    predicate?: IRI;
    object?: IRI | BlankNode | Literal;
    graph?: IRI | null;
}

/** A quad annotated with its temporal metadata (returned by findHistory). */
export interface QuadHistory extends Quad {
    /** When this edge was first asserted. */
    createdAt: Date;
    /** When this edge was last modified (same as deletedAt when soft-deleted). */
    updatedAt: Date;
    /** True if this version has been superseded by a newer assertion. */
    isDeleted: boolean;
    /** When this version was soft-deleted; null while still active. */
    deletedAt: Date | null;
}

/**
 * Options for a transitive-closure (reachability) walk over the edge graph.
 *
 * Starting from `roots`, follow edges whose predicate is in `predicates`,
 * in the given `direction`, and return every node reached (including the roots
 * unless `includeRoots` is false).  The walk is evaluated as a single recursive
 * CTE — one round-trip regardless of depth — and is cycle-safe.
 */
export interface ReachOptions {
    /** Starting nodes for the walk. */
    roots: readonly IRI[];
    /** Edge predicates to follow.  Empty ⇒ only the roots are reachable. */
    predicates: readonly IRI[];
    /**
     * "out" follows subject → object (e.g. memberOf, inheritsFrom, parent).
     * "in"  follows object → subject (e.g. find a subtree's descendants from its root).
     */
    direction: "out" | "in";
    /** Graph scope: an IRI for a named graph, null for the default graph, undefined for any graph. */
    graph?: IRI | null;
    /**
     * Maximum number of hops from the roots.  When set, depth is bounded
     * (roots are depth 0).  When omitted, the walk runs to full closure using
     * set semantics, which terminates even on cyclic graphs.
     */
    maxDepth?: number;
    /** Include the root IRIs in the result.  Defaults to true. */
    includeRoots?: boolean;
}

export interface StoreStats {
    namespaces: number;
    names: number;
    nodes: number;
    /** Count of active (non-deleted) edges only. */
    edges: number;
    /** Count of all edges including soft-deleted history. */
    edgesTotal: number;
}

// ── TripleStore ───────────────────────────────────────────────────────────────

/**
 * Graph + time-series RDF quad store backed by Knex.
 *
 * Schema (see migrations/001_init.ts + 002_time_series.ts):
 *   tern_namespaces — prefix → IRI mappings
 *   tern_names      — every unique IRI interned once
 *   tern_nodes      — every RDF term (IRI / blank / literal); all carry created_at + updated_at.
 *                     Literal nodes additionally store a typed JSONB payload in value_json.
 *   tern_edges      — quads (subject, predicate, object, graph) with full temporal metadata.
 *
 * All writes are append-only:
 *   - Nodes are interned on first use and never deleted.
 *   - Edges are soft-deleted (is_deleted=true + deleted_at timestamp) rather than
 *     physically removed.  findHistory() returns the full audit trail.
 */
export class TripleStore {
    private readonly _knex: Knex;

    constructor(knex: Knex) {
        this._knex = knex;
    }

    /** Direct access to the underlying Knex instance for advanced queries. */
    get knex(): Knex {
        return this._knex;
    }

    /**
     * Returns the transaction to run a query on. Every store operation MUST run
     * inside a transaction — nothing executes outside one, not even a single
     * read. Callers establish a transaction with `withTransaction(ctx, ...)`,
     * which threads `ctx.trx`. Hitting the raw connection would commit
     * immediately and outside any unit of work, so the absence of `ctx.trx` is
     * a programming error and throws rather than silently falling back.
     */
    private _db(ctx: ServerContext): Knex {
        const trx = ctx.trx as Knex | undefined;
        if (!trx) {
            throw new Error(
                "TripleStore: no active transaction. Every store operation must run inside " +
                    "store.withTransaction(ctx, ...) — no query may execute outside a transaction.",
            );
        }
        return trx;
    }

    /** Inserts a row and returns its auto-increment ID, for both Postgres and SQLite. */
    private async _insert(
        ctx: ServerContext,
        table: string,
        data: Record<string, unknown>,
    ): Promise<number> {
        if (this._isPg()) {
            const [row] = (await this._db(ctx)(table).insert(data).returning("id")) as [
                { id: number },
            ];
            return row.id;
        }
        const [id] = (await this._db(ctx)(table).insert(data)) as [number];
        return id;
    }

    // ── Transaction ───────────────────────────────────────────────────────────

    async withTransaction<T, C extends ServerContext>(
        ctx: C,
        fn: (ctx: C) => Promise<T>,
    ): Promise<T> {
        if (ctx.trx) {
            return fn(ctx);
        }
        return this._knex.transaction(async (trx) => fn({ ...ctx, trx } as C));
    }

    // ── Namespace registry ────────────────────────────────────────────────────

    async ensureNamespace(ctx: ServerContext, prefix: string, iriStr: string): Promise<number> {
        return this.withTransaction(ctx, (ctx) => this._ensureNamespace(ctx, prefix, iriStr));
    }

    private async _ensureNamespace(
        ctx: ServerContext,
        prefix: string,
        iriStr: string,
    ): Promise<number> {
        const row = await this._db(ctx)(T.namespaces)
            .where(C.prefix, prefix)
            .first<{ id: number }>();
        if (row) {
            return row.id;
        }
        return this._insert(ctx, T.namespaces, { [C.prefix]: prefix, [C.iri]: iriStr });
    }

    // ── Term internment ───────────────────────────────────────────────────────

    async ensureName(ctx: ServerContext, iriStr: string): Promise<number> {
        return this.withTransaction(ctx, (ctx) => this._ensureName(ctx, iriStr));
    }

    private async _ensureName(ctx: ServerContext, iriStr: string): Promise<number> {
        const row = await this._db(ctx)(T.names).where(C.iri, iriStr).first<NameRow>();
        if (row) {
            return row.id;
        }
        return this._insert(ctx, T.names, { [C.iri]: iriStr });
    }

    async ensureNode(ctx: ServerContext, term: RdfTerm): Promise<number> {
        return this.withTransaction(ctx, (ctx) => this._ensureNode(ctx, term));
    }

    private async _ensureNode(ctx: ServerContext, term: RdfTerm): Promise<number> {
        if (isIRI(term)) {
            const nameId = await this.ensureName(ctx, term.value);
            const row = await this._db(ctx)(T.nodes)
                .where({ [C.kind]: "iri", [C.nameId]: nameId })
                .first<NodeRow>();
            if (row) {
                return row.id;
            }
            return this._insert(ctx, T.nodes, { [C.kind]: "iri", [C.nameId]: nameId });
        }

        if (term.termType === "BlankNode") {
            const row = await this._db(ctx)(T.nodes)
                .where({ [C.kind]: "blank", [C.blank]: term.id })
                .first<NodeRow>();
            if (row) {
                return row.id;
            }
            return this._insert(ctx, T.nodes, { [C.kind]: "blank", [C.blank]: term.id });
        }

        // Literal node — deduplicate by (value, datatype, lang), populate value_json
        /* v8 ignore next */
        const dtIri = term.datatype?.value ?? "http://www.w3.org/2001/XMLSchema#string";
        const row = await this._db(ctx)(T.nodes)
            .where({
                [C.kind]: "literal",
                [C.value]: term.value,
                [C.datatype]: dtIri,
                [C.lang]: term.language ?? null,
            })
            .first<NodeRow>();
        if (row) {
            return row.id;
        }

        const jsonPayload = makeLiteralJson(term.value, dtIri, term.language);
        return this._insert(ctx, T.nodes, {
            [C.kind]: "literal",
            [C.value]: term.value,
            [C.datatype]: dtIri,
            [C.lang]: term.language ?? null,
            [C.valueJson]: JSON.stringify(jsonPayload),
        });
    }

    // ── Write ─────────────────────────────────────────────────────────────────

    /**
     * Asserts a quad.  Idempotent: if an identical active quad already exists,
     * nothing is written.  Restores a previously soft-deleted quad by creating
     * a fresh edge row (the soft-deleted row is left as history).
     */
    async insert(ctx: ServerContext, quad: Quad): Promise<void> {
        return this.withTransaction(ctx, (ctx) => this._insertQuad(ctx, quad));
    }

    private async _insertQuad(ctx: ServerContext, quad: Quad): Promise<void> {
        const [sId, pId, oId] = await Promise.all([
            this.ensureNode(ctx, quad.subject as RdfTerm),
            this.ensureNode(ctx, quad.predicate as IRI),
            this.ensureNode(ctx, quad.object as RdfTerm),
        ]);

        const gIsDefault =
            !quad.graph || ("termType" in quad.graph && quad.graph.termType === "DefaultGraph");
        const gId = gIsDefault ? null : await this.ensureNode(ctx, quad.graph as IRI);

        // Deduplication: skip if an active edge with exactly this quad already exists
        const existsQ = this._db(ctx)(T.edges)
            .where({ [C.subject]: sId, [C.predicate]: pId, [C.object]: oId })
            .where(C.isDeleted, false);
        if (gId === null) {
            existsQ.whereNull(C.graph);
        } else {
            existsQ.where(C.graph, gId);
        }

        const existing = await existsQ.first<{ id: number }>();
        if (existing) {
            return;
        }

        await this._db(ctx)(T.edges).insert({
            [C.subject]: sId,
            [C.predicate]: pId,
            [C.object]: oId,
            [C.graph]: gId,
            [C.isDeleted]: false,
        });
    }

    async insertMany(ctx: ServerContext, quads: readonly Quad[]): Promise<void> {
        return this.withTransaction(ctx, async (ctx) => {
            for (const q of quads) {
                await this.insert(ctx, q);
            }
        });
    }

    // ── Read ──────────────────────────────────────────────────────────────────

    /**
     * Finds all active (non-deleted) quads matching the pattern.
     * To include historical (soft-deleted) quads, use findHistory().
     */
    async find(ctx: ServerContext, pattern: QuadPattern = {}): Promise<Quad[]> {
        return this.withTransaction(ctx, (ctx) => this._find(ctx, pattern));
    }

    private async _find(ctx: ServerContext, pattern: QuadPattern = {}): Promise<Quad[]> {
        let q = this._db(ctx)(T.edges).where(C.isDeleted, false).select<EdgeRow[]>("*");
        const ids = await this._patternIds(ctx, pattern);
        if (ids === null) {
            return [];
        }
        q = this._addPatternClauses(q, ids);
        const edges = await q;
        if (edges.length === 0) {
            return [];
        }
        return this._hydrateEdges(ctx, edges);
    }

    /**
     * Like find(), but returns edges sorted by insertion order (edge id ascending).
     * Use this when the order of results is semantically meaningful (e.g. ordered collections).
     */
    async findOrdered(ctx: ServerContext, pattern: QuadPattern): Promise<Quad[]> {
        return this.withTransaction(ctx, (ctx) => this._findOrdered(ctx, pattern));
    }

    private async _findOrdered(ctx: ServerContext, pattern: QuadPattern): Promise<Quad[]> {
        let q = this._db(ctx)(T.edges)
            .where(C.isDeleted, false)
            .orderBy(C.id, "asc")
            .select<EdgeRow[]>("*");
        const ids = await this._patternIds(ctx, pattern);
        if (ids === null) {
            return [];
        }
        q = this._addPatternClauses(q, ids);
        const edges = await q;
        if (edges.length === 0) {
            return [];
        }
        return this._hydrateEdges(ctx, edges);
    }

    /**
     * Returns ALL versions of quads matching the pattern, including soft-deleted
     * ones, in ascending creation order.  Each result is annotated with temporal metadata.
     */
    async findHistory(ctx: ServerContext, pattern: QuadPattern = {}): Promise<QuadHistory[]> {
        return this.withTransaction(ctx, (ctx) => this._findHistory(ctx, pattern));
    }

    private async _findHistory(
        ctx: ServerContext,
        pattern: QuadPattern = {},
    ): Promise<QuadHistory[]> {
        let q = this._db(ctx)(T.edges).orderBy(C.createdAt, "asc").select<EdgeRow[]>("*");
        const ids = await this._patternIds(ctx, pattern);
        if (ids === null) {
            return [];
        }
        q = this._addPatternClauses(q, ids);
        const edges = await q;
        if (edges.length === 0) {
            return [];
        }

        const nodeIds = new Set<number>();
        for (const e of edges) {
            nodeIds.add(e.subject);
            nodeIds.add(e.predicate);
            nodeIds.add(e.object);
            if (e.graph !== null) {
                nodeIds.add(e.graph);
            }
        }
        const nodeMap = await this._loadNodes(ctx, [...nodeIds]);

        return edges.map((e) => {
            const subject = nodeMap.get(e.subject);
            if (subject == null) {
                throw new Error(`findHistory: missing node for subject id ${e.subject}`);
            }
            const predicate = nodeMap.get(e.predicate);
            if (predicate == null) {
                throw new Error(`findHistory: missing node for predicate id ${e.predicate}`);
            }
            const object = nodeMap.get(e.object);
            if (object == null) {
                throw new Error(`findHistory: missing node for object id ${e.object}`);
            }
            let graph: IRI | DefaultGraph;
            if (e.graph !== null) {
                const graphNode = nodeMap.get(e.graph);
                if (graphNode == null) {
                    throw new Error(`findHistory: missing node for graph id ${e.graph}`);
                }
                graph = graphNode as IRI;
            } else {
                graph = DEFAULT_GRAPH satisfies DefaultGraph;
            }
            return {
                subject: subject as IRI | BlankNode,
                predicate: predicate as IRI,
                object: object as RdfTerm,
                graph,
                createdAt: new Date(e.created_at),
                updatedAt: new Date(e.updated_at),
                isDeleted: !!e.is_deleted,
                deletedAt: e.deleted_at ? new Date(e.deleted_at) : null,
            };
        });
    }

    // ── Soft delete ───────────────────────────────────────────────────────────

    /**
     * Soft-deletes all active edges matching the pattern.
     * Returns the count of edges marked as deleted.
     * No data is physically removed.
     */
    async delete(ctx: ServerContext, pattern: QuadPattern): Promise<number> {
        return this.withTransaction(ctx, (ctx) => this._delete(ctx, pattern));
    }

    private async _delete(ctx: ServerContext, pattern: QuadPattern): Promise<number> {
        const ids = await this._patternIds(ctx, pattern);
        if (ids === null) {
            return 0;
        }
        let q = this._db(ctx)(T.edges).where(C.isDeleted, false);
        q = this._addPatternClauses(q, ids);
        return q.update({ [C.isDeleted]: true });
    }

    /**
     * Soft-deletes all active edges whose subject is one of the given terms.
     * Single SQL round-trip — use instead of calling delete() N times.
     */
    async deleteSubjects(
        ctx: ServerContext,
        subjects: readonly (IRI | BlankNode)[],
        graph?: IRI | null,
    ): Promise<number> {
        return this.withTransaction(ctx, (ctx) => this._deleteSubjects(ctx, subjects, graph));
    }

    private async _deleteSubjects(
        ctx: ServerContext,
        subjects: readonly (IRI | BlankNode)[],
        graph?: IRI | null,
    ): Promise<number> {
        if (subjects.length === 0) {
            return 0;
        }
        const ids = await Promise.all(subjects.map((s) => this._nodeId(ctx, s as RdfTerm)));
        const validIds = ids.filter((id): id is number => id !== null);
        if (validIds.length === 0) {
            return 0;
        }

        let q = this._db(ctx)(T.edges).whereIn(C.subject, validIds).where(C.isDeleted, false);
        if (graph !== undefined) {
            q =
                graph === null
                    ? q.whereNull(C.graph)
                    : q.where(C.graph, await this._nodeId(ctx, graph));
        }
        return q.update({ [C.isDeleted]: true });
    }

    /**
     * Soft-deletes active edges matching a subject AND whose predicate is one
     * of the given IRIs.  Single SQL round-trip — use in updateGroup instead
     * of N × delete(predicate).
     */
    async deleteBySubjectPredicates(
        ctx: ServerContext,
        subject: IRI | BlankNode,
        predicates: readonly IRI[],
        graph?: IRI | null,
    ): Promise<number> {
        return this.withTransaction(ctx, (ctx) =>
            this._deleteBySubjectPredicates(ctx, subject, predicates, graph),
        );
    }

    private async _deleteBySubjectPredicates(
        ctx: ServerContext,
        subject: IRI | BlankNode,
        predicates: readonly IRI[],
        graph?: IRI | null,
    ): Promise<number> {
        if (predicates.length === 0) {
            return 0;
        }
        const sId = await this._nodeId(ctx, subject as RdfTerm);
        if (sId === null) {
            return 0;
        }
        const pIds = await Promise.all(predicates.map((p) => this._nodeId(ctx, p as RdfTerm)));
        const validPIds = pIds.filter((id): id is number => id !== null);
        if (validPIds.length === 0) {
            return 0;
        }

        let q = this._db(ctx)(T.edges)
            .where(C.subject, sId)
            .whereIn(C.predicate, validPIds)
            .where(C.isDeleted, false);
        if (graph !== undefined) {
            q =
                graph === null
                    ? q.whereNull(C.graph)
                    : q.where(C.graph, await this._nodeId(ctx, graph));
        }
        return q.update({ [C.isDeleted]: true });
    }

    // ── Batch read ────────────────────────────────────────────────────────────

    /**
     * Fetches all active quads for a list of subjects in a single round-trip.
     * Returns a Map keyed by subject IRI string (or `_:id` for blank nodes).
     */
    async findForSubjects(
        ctx: ServerContext,
        subjects: readonly (IRI | BlankNode)[],
        graph?: IRI | null,
    ): Promise<Map<string, Quad[]>> {
        return this.withTransaction(ctx, (ctx) => this._findForSubjects(ctx, subjects, graph));
    }

    private async _findForSubjects(
        ctx: ServerContext,
        subjects: readonly (IRI | BlankNode)[],
        graph?: IRI | null,
    ): Promise<Map<string, Quad[]>> {
        if (subjects.length === 0) {
            return new Map();
        }

        const pairs = await Promise.all(
            subjects.map(async (s) => [s, await this._nodeId(ctx, s as RdfTerm)] as const),
        );
        const validPairs = pairs.filter((p): p is [IRI | BlankNode, number] => p[1] !== null);
        if (validPairs.length === 0) {
            return new Map();
        }

        const idToSubject = new Map(validPairs.map(([term, id]) => [id, term]));
        const graphId =
            graph !== undefined
                ? graph === null
                    ? null
                    : await this._nodeId(ctx, graph)
                : undefined;

        let edgesQ = this._db(ctx)(T.edges)
            .whereIn(
                C.subject,
                validPairs.map(([, id]) => id),
            )
            .where(C.isDeleted, false);
        if (graphId !== undefined) {
            edgesQ = graphId === null ? edgesQ.whereNull(C.graph) : edgesQ.where(C.graph, graphId);
        }
        const edges = await edgesQ.select<EdgeRow[]>("*");

        if (edges.length === 0) {
            return new Map();
        }

        const nodeIds = new Set<number>();
        for (const e of edges) {
            nodeIds.add(e.subject);
            nodeIds.add(e.predicate);
            nodeIds.add(e.object);
            if (e.graph !== null) {
                nodeIds.add(e.graph);
            }
        }
        const nodeMap = await this._loadNodes(ctx, [...nodeIds]);

        const result = new Map<string, Quad[]>();
        for (const e of edges) {
            const subjTerm = idToSubject.get(e.subject);
            if (subjTerm == null) {
                throw new Error(`findForSubjects: missing subject term for id ${e.subject}`);
            }
            const key = isIRI(subjTerm) ? subjTerm.value : `_:${(subjTerm as BlankNode).id}`;
            if (!result.has(key)) {
                result.set(key, []);
            }
            const subjectNode = nodeMap.get(e.subject);
            if (subjectNode == null) {
                throw new Error(`findForSubjects: missing node for subject id ${e.subject}`);
            }
            const predicateNode = nodeMap.get(e.predicate);
            if (predicateNode == null) {
                throw new Error(`findForSubjects: missing node for predicate id ${e.predicate}`);
            }
            const objectNode = nodeMap.get(e.object);
            if (objectNode == null) {
                throw new Error(`findForSubjects: missing node for object id ${e.object}`);
            }
            let graph: IRI | DefaultGraph;
            if (e.graph !== null) {
                const graphNode = nodeMap.get(e.graph);
                if (graphNode == null) {
                    throw new Error(`findForSubjects: missing node for graph id ${e.graph}`);
                }
                graph = graphNode as IRI;
            } else {
                graph = DEFAULT_GRAPH satisfies DefaultGraph;
            }
            result.get(key)?.push({
                subject: subjectNode as IRI | BlankNode,
                predicate: predicateNode as IRI,
                object: objectNode as RdfTerm,
                graph,
            });
        }
        return result;
    }

    // ── Graph reachability ────────────────────────────────────────────────────

    /**
     * Transitive closure over the edge graph: starting from `opts.roots`, follow
     * edges of the given predicate(s) in the given direction and return every
     * IRI node reached.  Evaluated as a single recursive CTE — one round-trip
     * regardless of path length — and cycle-safe.
     *
     * This is the topology primitive that replaces every client-side BFS/while
     * graph walk (RBAC scope chains, group membership, role inheritance,
     * entity ownership).  Postgres and SQLite share the WITH RECURSIVE syntax;
     * only the boolean literal differs.
     */
    async reachable(ctx: ServerContext, opts: ReachOptions): Promise<IRI[]> {
        return this.withTransaction(ctx, (ctx) => this._reachable(ctx, opts));
    }

    private async _reachable(ctx: ServerContext, opts: ReachOptions): Promise<IRI[]> {
        const includeRoots = opts.includeRoots ?? true;

        const rootIds = (
            await Promise.all(opts.roots.map((r) => this._nodeId(ctx, r as RdfTerm)))
        ).filter((id): id is number => id !== null);
        if (rootIds.length === 0) {
            return [];
        }

        const predIds = (
            await Promise.all(opts.predicates.map((p) => this._nodeId(ctx, p as RdfTerm)))
        ).filter((id): id is number => id !== null);

        // No resolvable predicates ⇒ no edges to follow; only the roots qualify.
        if (predIds.length === 0) {
            const rootSet = new Set(rootIds);
            return includeRoots ? this._idsToIris(ctx, [...rootSet]) : [];
        }

        let graphClause = "1 = 1";
        if (opts.graph !== undefined) {
            if (opts.graph === null) {
                graphClause = `e.${C.graph} IS NULL`;
            } else {
                const gId = await this._nodeId(ctx, opts.graph as RdfTerm);
                if (gId === null) {
                    // Graph never interned ⇒ no edges in it; only roots qualify.
                    return includeRoots ? this._idsToIris(ctx, rootIds) : [];
                }
                graphClause = `e.${C.graph} = ${gId}`;
            }
        }

        const fromCol = opts.direction === "out" ? C.subject : C.object;
        const toCol = opts.direction === "out" ? C.object : C.subject;
        const isPg = this._isPg();
        const falseLit = isPg ? "false" : "0";
        const rootList = rootIds.join(", ");
        const predList = predIds.join(", ");

        const sql =
            opts.maxDepth !== undefined
                ? `WITH RECURSIVE reach(node, depth) AS (
                    SELECT ${C.id}, 0 FROM ${T.nodes} WHERE ${C.id} IN (${rootList})
                    UNION ALL
                    SELECT e.${toCol}, r.depth + 1
                    FROM ${T.edges} e JOIN reach r ON e.${fromCol} = r.node
                    WHERE r.depth < ${Number(opts.maxDepth)}
                      AND e.${C.predicate} IN (${predList})
                      AND e.${C.isDeleted} = ${falseLit}
                      AND ${graphClause}
                   ) SELECT DISTINCT node FROM reach`
                : `WITH RECURSIVE reach(node) AS (
                    SELECT ${C.id} FROM ${T.nodes} WHERE ${C.id} IN (${rootList})
                    UNION
                    SELECT e.${toCol}
                    FROM ${T.edges} e JOIN reach r ON e.${fromCol} = r.node
                    WHERE e.${C.predicate} IN (${predList})
                      AND e.${C.isDeleted} = ${falseLit}
                      AND ${graphClause}
                   ) SELECT node FROM reach`;

        const raw = await this._db(ctx).raw(sql);
        const rows = (Array.isArray(raw) ? raw : raw.rows) as Array<{ node: number }>;

        const rootSet = new Set(rootIds);
        const ids = rows
            .map((r) => Number(r.node))
            .filter((id) => includeRoots || !rootSet.has(id));
        return this._idsToIris(ctx, ids);
    }

    /** Resolves a set of node ids to their IRI terms, dropping any non-IRI (literal/blank) nodes. */
    private async _idsToIris(ctx: ServerContext, ids: number[]): Promise<IRI[]> {
        if (ids.length === 0) {
            return [];
        }
        const unique = [...new Set(ids)];
        const nodeMap = await this._loadNodes(ctx, unique);
        const result: IRI[] = [];
        for (const id of unique) {
            const term = nodeMap.get(id);
            if (term && isIRI(term)) {
                result.push(term);
            }
        }
        return result;
    }

    /** True when the underlying Knex client is Postgres. */
    private _isPg(): boolean {
        const client = (this._knex.client as { config: { client: string } }).config.client;
        return client === "pg" || client === "postgresql";
    }

    // ── Stats ─────────────────────────────────────────────────────────────────

    async stats(ctx: ServerContext): Promise<StoreStats> {
        return this.withTransaction(ctx, (ctx) => this._stats(ctx));
    }

    private async _stats(ctx: ServerContext): Promise<StoreStats> {
        const [ns, na, no, ne, net] = await Promise.all([
            this._db(ctx)(T.namespaces).count<[{ count: number }]>(`${C.id} as count`),
            this._db(ctx)(T.names).count<[{ count: number }]>(`${C.id} as count`),
            this._db(ctx)(T.nodes).count<[{ count: number }]>(`${C.id} as count`),
            this._db(ctx)(T.edges)
                .where(C.isDeleted, false)
                .count<[{ count: number }]>(`${C.id} as count`),
            this._db(ctx)(T.edges).count<[{ count: number }]>(`${C.id} as count`),
        ]);
        return {
            namespaces: Number(ns[0].count),
            names: Number(na[0].count),
            nodes: Number(no[0].count),
            edges: Number(ne[0].count),
            edgesTotal: Number(net[0].count),
        };
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private async _nodeId(ctx: ServerContext, term: RdfTerm): Promise<number | null> {
        if (isIRI(term)) {
            const name = await this._db(ctx)(T.names).where(C.iri, term.value).first<NameRow>();
            if (!name) {
                return null;
            }
            const node = await this._db(ctx)(T.nodes)
                .where({ [C.kind]: "iri", [C.nameId]: name.id })
                .first<NodeRow>();
            /* v8 ignore next */
            return node?.id ?? null;
        }

        if (term.termType === "BlankNode") {
            const node = await this._db(ctx)(T.nodes)
                .where({ [C.kind]: "blank", [C.blank]: term.id })
                .first<NodeRow>();
            return node?.id ?? null;
        }

        // Literal
        /* v8 ignore next */
        const dtIri = term.datatype?.value ?? "http://www.w3.org/2001/XMLSchema#string";
        const node = await this._db(ctx)(T.nodes)
            .where({
                [C.kind]: "literal",
                [C.value]: term.value,
                [C.datatype]: dtIri,
                [C.lang]: term.language ?? null,
            })
            .first<NodeRow>();
        return node?.id ?? null;
    }

    /**
     * Resolves a QuadPattern to concrete node IDs.
     * Returns null (meaning "no rows can match") if any required node isn't in the store.
     */
    private async _patternIds(
        ctx: ServerContext,
        pattern: QuadPattern,
    ): Promise<{
        subject?: number;
        predicate?: number;
        object?: number;
        graphId?: number | null; // null = default graph; undefined = no graph filter
    } | null> {
        const result: {
            subject?: number;
            predicate?: number;
            object?: number;
            graphId?: number | null;
        } = {};

        if (pattern.subject !== undefined) {
            const id = await this._nodeId(ctx, pattern.subject);
            if (id === null) {
                return null;
            }
            result.subject = id;
        }
        if (pattern.predicate !== undefined) {
            const id = await this._nodeId(ctx, pattern.predicate);
            if (id === null) {
                return null;
            }
            result.predicate = id;
        }
        if (pattern.object !== undefined) {
            const id = await this._nodeId(ctx, pattern.object);
            if (id === null) {
                return null;
            }
            result.object = id;
        }
        if (pattern.graph !== undefined) {
            if (pattern.graph === null) {
                result.graphId = null;
            } else {
                const id = await this._nodeId(ctx, pattern.graph);
                if (id === null) {
                    return null;
                }
                result.graphId = id;
            }
        }
        return result;
    }

    /** Applies resolved pattern IDs as WHERE clauses to a query builder. */
    private _addPatternClauses<R extends object>(
        q: Knex.QueryBuilder<R>,
        ids: Exclude<Awaited<ReturnType<TripleStore["_patternIds"]>>, null>,
    ): Knex.QueryBuilder<R> {
        if (ids.subject !== undefined) {
            q = q.where(C.subject, ids.subject);
        }
        if (ids.predicate !== undefined) {
            q = q.where(C.predicate, ids.predicate);
        }
        if (ids.object !== undefined) {
            q = q.where(C.object, ids.object);
        }
        if (ids.graphId !== undefined) {
            q = ids.graphId === null ? q.whereNull(C.graph) : q.where(C.graph, ids.graphId);
        }
        return q;
    }

    private async _hydrateEdges(ctx: ServerContext, edges: EdgeRow[]): Promise<Quad[]> {
        const nodeIds = new Set<number>();
        for (const e of edges) {
            nodeIds.add(e.subject);
            nodeIds.add(e.predicate);
            nodeIds.add(e.object);
            if (e.graph !== null) {
                nodeIds.add(e.graph);
            }
        }
        const nodeMap = await this._loadNodes(ctx, [...nodeIds]);

        return edges.map((e) => {
            const subject = nodeMap.get(e.subject);
            if (subject == null) {
                throw new Error(`_hydrateEdges: missing node for subject id ${e.subject}`);
            }
            const predicate = nodeMap.get(e.predicate);
            if (predicate == null) {
                throw new Error(`_hydrateEdges: missing node for predicate id ${e.predicate}`);
            }
            const object = nodeMap.get(e.object);
            if (object == null) {
                throw new Error(`_hydrateEdges: missing node for object id ${e.object}`);
            }
            let graph: IRI | DefaultGraph;
            if (e.graph !== null) {
                const graphNode = nodeMap.get(e.graph);
                if (graphNode == null) {
                    throw new Error(`_hydrateEdges: missing node for graph id ${e.graph}`);
                }
                graph = graphNode as IRI;
            } else {
                graph = DEFAULT_GRAPH satisfies DefaultGraph;
            }
            return {
                subject: subject as IRI | BlankNode,
                predicate: predicate as IRI,
                object: object as RdfTerm,
                graph,
            };
        });
    }

    private async _loadNodes(ctx: ServerContext, ids: number[]): Promise<Map<number, RdfTerm>> {
        /* v8 ignore next */
        if (ids.length === 0) {
            return new Map();
        }

        const nodes = await this._db(ctx)(T.nodes).whereIn(C.id, ids).select<NodeRow[]>("*");

        const iriNodeIds = nodes
            .filter((n) => n.kind === "iri" && n.name_id !== null)
            .map((n) => n.name_id as number);
        /* v8 ignore next */
        const names: NameRow[] =
            iriNodeIds.length > 0
                ? await this._db(ctx)(T.names).whereIn(C.id, iriNodeIds).select<NameRow[]>("*")
                : [];
        const nameMap = new Map(names.map((n) => [n.id, n.iri]));

        /* v8 ignore next */
        return new Map(
            nodes.map((n) => [
                n.id,
                nodeToTerm(n, n.name_id !== null ? (nameMap.get(n.name_id) ?? null) : null),
            ]),
        );
    }
}
