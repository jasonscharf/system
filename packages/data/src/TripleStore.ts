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
import { C, DEFAULT_GRAPH_IRI, type LiteralJson, type NodeKind, T } from "./schema.js";

interface ServerContext extends ApplicationContext {
    trx?: Knex.Transaction;
}

// ── Internal row types ────────────────────────────────────────────────────────

interface NodeRow {
    id: number;
    kind: NodeKind;
    /** IRI string for kind='iri'; null otherwise. */
    iri: string | null;
    /** Blank-node identifier for kind='blank'; null otherwise. */
    blank_id: string | null;
    value: string | null;
    dt: string | null;
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
    graph: number;
    created_at: string;
    updated_at: string;
    is_deleted: boolean;
    deleted_at: string | null;
}

type RdfTerm = IRI | BlankNode | Literal;

/**
 * A literal whose lexical `value` already holds ciphertext.  The entity layer
 * produces these for PII properties: it encrypts the plaintext before the value
 * ever reaches the store, then tags the term with the key id so internment can
 * persist the `is_encrypted` / `key_id` columns on the node row.  The store
 * stays oblivious to plaintext — it never encrypts or decrypts, it only records
 * that the interned value is ciphertext.  The extra fields are in-process hints
 * on the quad object and are never written as RDF.
 */
interface EncryptedLiteral extends Literal {
    /** Marks `value` as ciphertext. */
    encrypted: true;
    /** Id of the key that produced the ciphertext (persisted for rotation). */
    keyId: string;
}

function isEncryptedLiteral(term: RdfTerm): term is EncryptedLiteral {
    return (
        "termType" in term &&
        term.termType === "Literal" &&
        (term as Partial<EncryptedLiteral>).encrypted === true
    );
}

// ── Module-level constants ────────────────────────────────────────────────────

const DEFAULT_GRAPH_NODE = makeIRI(DEFAULT_GRAPH_IRI);

// ── Literal JSONB helpers ─────────────────────────────────────────────────────

const XSD = "http://www.w3.org/2001/XMLSchema#";

function coerceLiteralValue(value: string, datatypeIri: string): string | number | boolean {
    switch (datatypeIri) {
        case `${XSD}boolean`:
            return value === "true";
        case `${XSD}integer`:
        case `${XSD}int`:
        case `${XSD}long`:
        case `${XSD}short`:
        case `${XSD}byte`:
        case `${XSD}unsignedInt`:
        case `${XSD}unsignedLong`:
        case `${XSD}unsignedShort`: {
            const n = parseInt(value, 10);
            return Number.isNaN(n) ? value : n;
        }
        case `${XSD}decimal`:
        case `${XSD}float`:
        case `${XSD}double`: {
            const n = parseFloat(value);
            return Number.isNaN(n) ? value : n;
        }
        default:
            return value;
    }
}

function makeLiteralJson(value: string, datatypeIri: string, language?: string): LiteralJson {
    const json: LiteralJson = { v: coerceLiteralValue(value, datatypeIri) };
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

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

function makeIRI(iriStr: string): IRI {
    return { value: iriStr } as IRI;
}

function isIRI(term: RdfTerm): term is IRI {
    return !("termType" in term);
}

function nodeToTerm(row: NodeRow): RdfTerm {
    if (row.kind === "iri") {
        if (row.iri == null) {
            throw new Error("nodeToTerm: iri must not be null for IRI node");
        }
        return makeIRI(row.iri);
    }
    if (row.kind === "blank") {
        if (row.blank_id == null) {
            throw new Error("nodeToTerm: blank_id must not be null for blank node");
        }
        return { termType: "BlankNode", id: row.blank_id } satisfies BlankNode;
    }

    // Literal — prefer the typed JSONB payload when present
    const json = parseLiteralJson(row.value_json);
    /* v8 ignore next -- row.dt is always set by ensureNode */
    const dtIri = row.dt ?? "http://www.w3.org/2001/XMLSchema#string";
    if (json) {
        return {
            termType: "Literal",
            value: String(json.v),
            datatype: makeIRI(dtIri),
            language: json.lang ?? undefined,
        } satisfies Literal;
    }

    // Fallback: rows without value_json (pre-002 rows in existing DBs)
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
    /**
     * Named graph IRI to scope the query.
     * Pass `null` to scope to the default graph (urn:sys:graph:default).
     * Omit to match across all graphs.
     */
    graph?: IRI | null;
}

/** DB-managed creation/modification timestamps for an entity (a subject IRI). */
export interface EntityTimestamps {
    /** Earliest created_at across the subject's live edges (anchored by rdf:type). */
    createdAt: Date;
    /** Latest updated_at across the subject's live edges (newest write). */
    updatedAt: Date;
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

/** One hop in a rooted traversal: follow `predicate` out (current→next) or in (next→current). */
export interface TraverseHop {
    predicate: IRI;
    direction: "out" | "in";
}

/**
 * A rooted graph traversal: the path that every domain query must walk from the
 * tenant root down to its leaf. Compiles to a single chain of inner joins on
 * edges (one per hop), scoped to `graph` and live edges, so a result is
 * returned only if the full root→leaf path exists. There is no flat
 * "find nodes of type X" — reachability from the root is the query.
 */
export interface RootedTraverseOpts {
    /** The node the path must start from (e.g. the caller's tenant). */
    root: IRI;
    /** Ordered hops from the root to the leaf. Empty ⇒ the leaf is the root. */
    hops: readonly TraverseHop[];
    /** Graph scope: a named graph IRI, null for the default graph, undefined for any graph. */
    graph?: IRI | null;
    /** Optional rdf:type constraint on the leaf node. */
    leafType?: IRI;
    /** Optional leaf property-equality constraints (leaf --predicate--> object). */
    leafEq?: readonly { predicate: IRI; object: IRI | Literal }[];
}

export interface StoreStats {
    namespaces: number;
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
 * Schema (see migrations/001_init.ts):
 *   namespaces — prefix → IRI mappings
 *   nodes      — every RDF term (IRI / blank / literal).
 *                IRI nodes store the full IRI string in the `iri` column.
 *                Blank nodes store the blank-node identifier in `blank_id`.
 *                Literal nodes store lexical form in `value`, datatype IRI in
 *                `datatype`, language in `lang`, and a typed JSONB payload in
 *                `value_json`.
 *   edges      — quads (subject, predicate, object, graph) with full temporal
 *                     metadata.  The `graph` column is always non-null: quads in the
 *                     RDF default graph use the well-known IRI urn:sys:graph:default.
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

    async ensureNode(ctx: ServerContext, term: RdfTerm): Promise<number> {
        return this.withTransaction(ctx, (ctx) => this._ensureNode(ctx, term));
    }

    private async _ensureNode(ctx: ServerContext, term: RdfTerm): Promise<number> {
        if (isIRI(term)) {
            const row = await this._db(ctx)(T.nodes)
                .where({ [C.kind]: "iri", [C.iri]: term.value })
                .first<NodeRow>();
            if (row) {
                return row.id;
            }
            return this._insert(ctx, T.nodes, { [C.kind]: "iri", [C.iri]: term.value });
        }

        if (term.termType === "BlankNode") {
            const row = await this._db(ctx)(T.nodes)
                .where({ [C.kind]: "blank", [C.blankId]: term.id })
                .first<NodeRow>();
            if (row) {
                return row.id;
            }
            return this._insert(ctx, T.nodes, { [C.kind]: "blank", [C.blankId]: term.id });
        }

        // Literal node — deduplicate by (value, dt, lang), populate value_json
        /* v8 ignore next */
        const dtIri = term.datatype?.value ?? "http://www.w3.org/2001/XMLSchema#string";
        const row = await this._db(ctx)(T.nodes)
            .where({
                [C.kind]: "literal",
                [C.value]: term.value,
                [C.dt]: dtIri,
                [C.lang]: term.language ?? null,
            })
            .first<NodeRow>();
        if (row) {
            return row.id;
        }

        const jsonPayload = makeLiteralJson(term.value, dtIri, term.language);
        const encrypted = isEncryptedLiteral(term);
        return this._insert(ctx, T.nodes, {
            [C.kind]: "literal",
            [C.value]: term.value,
            [C.dt]: dtIri,
            [C.lang]: term.language ?? null,
            [C.valueJson]: JSON.stringify(jsonPayload),
            [C.isEncrypted]: encrypted,
            [C.keyId]: encrypted ? term.keyId : null,
        });
    }

    // ── Write ─────────────────────────────────────────────────────────────────

    /**
     * Asserts a quad.  Idempotent: if an identical active quad already exists,
     * nothing is written.  Restores a previously soft-deleted quad by creating
     * a fresh edge row (the soft-deleted row is left as history).
     *
     * Quads with `graph: DEFAULT_GRAPH` or no graph are stored under the
     * well-known IRI urn:sys:graph:default so `graph` is never null.
     */
    async insert(ctx: ServerContext, quad: Quad): Promise<void> {
        return this.withTransaction(ctx, (ctx) => this._insertQuad(ctx, quad));
    }

    private async _insertQuad(ctx: ServerContext, quad: Quad): Promise<void> {
        const [sId, pId, oId] = await Promise.all([
            this._ensureNode(ctx, quad.subject as RdfTerm),
            this._ensureNode(ctx, quad.predicate as IRI),
            this._ensureNode(ctx, quad.object as RdfTerm),
        ]);

        const gIsDefault =
            !quad.graph || ("termType" in quad.graph && quad.graph.termType === "DefaultGraph");
        const graphTerm = gIsDefault ? DEFAULT_GRAPH_NODE : (quad.graph as IRI);
        const gId = await this._ensureNode(ctx, graphTerm);

        // Deduplication: skip if an active edge with exactly this quad already exists
        const existing = await this._db(ctx)(T.edges)
            .where({ [C.subject]: sId, [C.predicate]: pId, [C.object]: oId, [C.graph]: gId })
            .where(C.isDeleted, false)
            .first<{ id: number }>();
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
            nodeIds.add(e.graph);
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
            const graph = this._graphTermFromNode(nodeMap.get(e.graph));
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
            const gId = await this._resolveGraph(ctx, graph);
            if (gId === null) {
                return 0;
            }
            q = q.where(C.graph, gId);
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
            const gId = await this._resolveGraph(ctx, graph);
            if (gId === null) {
                return 0;
            }
            q = q.where(C.graph, gId);
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

        let edgesQ = this._db(ctx)(T.edges)
            .whereIn(
                C.subject,
                validPairs.map(([, id]) => id),
            )
            .where(C.isDeleted, false);
        if (graph !== undefined) {
            const gId = await this._resolveGraph(ctx, graph);
            if (gId === null) {
                return new Map();
            }
            edgesQ = edgesQ.where(C.graph, gId);
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
            nodeIds.add(e.graph);
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
            const graph = this._graphTermFromNode(nodeMap.get(e.graph));
            result.get(key)?.push({
                subject: subjectNode as IRI | BlankNode,
                predicate: predicateNode as IRI,
                object: objectNode as RdfTerm,
                graph,
            });
        }
        return result;
    }

    /**
     * Derives each subject's entity-level timestamps from the DB-managed
     * created_at / updated_at columns on its edge rows, aggregated per subject:
     *   createdAt = MIN(created_at), updatedAt = MAX(updated_at)
     * over the subject's non-deleted edges.  The rdf:type edge (never rewritten
     * by update) anchors createdAt; any property/edge write bumps updatedAt.
     *
     * Batched into one grouped query.  Subjects with no live edges are absent
     * from the returned map.
     */
    async entityTimestamps(
        ctx: ServerContext,
        subjects: readonly (IRI | BlankNode)[],
        graph?: IRI | null,
    ): Promise<Map<string, EntityTimestamps>> {
        return this.withTransaction(ctx, (ctx) => this._entityTimestamps(ctx, subjects, graph));
    }

    private async _entityTimestamps(
        ctx: ServerContext,
        subjects: readonly (IRI | BlankNode)[],
        graph?: IRI | null,
    ): Promise<Map<string, EntityTimestamps>> {
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

        let q = this._db(ctx)(T.edges)
            .whereIn(
                C.subject,
                validPairs.map(([, id]) => id),
            )
            .where(C.isDeleted, false);
        if (graph !== undefined) {
            const gId = await this._resolveGraph(ctx, graph);
            if (gId === null) {
                return new Map();
            }
            q = q.where(C.graph, gId);
        }
        const rows = await q
            .groupBy(C.subject)
            .select<{ subject: number; created_at: string; updated_at: string }[]>(
                C.subject,
                this._db(ctx).raw(`MIN(${C.createdAt}) as ${C.createdAt}`),
                this._db(ctx).raw(`MAX(${C.updatedAt}) as ${C.updatedAt}`),
            );

        const result = new Map<string, EntityTimestamps>();
        for (const row of rows) {
            const subjTerm = idToSubject.get(row.subject);
            /* v8 ignore next 3 -- subject ids come straight from idToSubject */
            if (subjTerm == null) {
                continue;
            }
            const key = isIRI(subjTerm) ? subjTerm.value : `_:${(subjTerm as BlankNode).id}`;
            result.set(key, {
                createdAt: new Date(row.created_at),
                updatedAt: new Date(row.updated_at),
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
            const gId = await this._resolveGraph(ctx, opts.graph);
            if (gId === null) {
                return includeRoots ? this._idsToIris(ctx, rootIds) : [];
            }
            graphClause = `e.${C.graph} = ${gId}`;
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

    /**
     * Walks a fixed path from `opts.root` to a leaf, following `opts.hops` as a
     * chain of inner joins on edges. Returns the leaf IRIs reachable via the
     * full path — the rooted-traversal primitive the query layer is built on.
     * Every join is scoped to `opts.graph` and live edges, so a leaf is returned
     * only when the entire root→leaf path exists in that graph.
     */
    async rootedTraverse(ctx: ServerContext, opts: RootedTraverseOpts): Promise<IRI[]> {
        return this.withTransaction(ctx, (ctx) => this._rootedTraverse(ctx, opts));
    }

    private async _rootedTraverse(ctx: ServerContext, opts: RootedTraverseOpts): Promise<IRI[]> {
        const rootId = await this._nodeId(ctx, opts.root as RdfTerm);
        if (rootId === null) {
            return [];
        }

        // Resolve the graph scope to a node id once; reused on every join.
        let graphId: number | undefined;
        if (opts.graph !== undefined) {
            const gId = await this._resolveGraph(ctx, opts.graph);
            if (gId === null) {
                return [];
            }
            graphId = gId;
        }
        const falseLit = this._isPg() ? "false" : "0";
        const scope = (alias: string): string => {
            const g =
                graphId === undefined ? "1 = 1" : `${alias}.${C.graph} = ${graphId}`;
            return `${g} AND ${alias}.${C.isDeleted} = ${falseLit}`;
        };

        // Resolve every predicate up front; an unknown predicate means no path.
        const hopPredIds: number[] = [];
        for (const hop of opts.hops) {
            const pid = await this._nodeId(ctx, hop.predicate as RdfTerm);
            if (pid === null) {
                return [];
            }
            hopPredIds.push(pid);
        }

        // Build the hop chain. e0 is anchored at the root; each hop's leaf feeds
        // the next hop's anchor. `leafExpr` is the SQL expression for the leaf id.
        const wheres: string[] = [];
        const joins: string[] = [];
        let leafExpr: string;
        let base: string;
        if (opts.hops.length === 0) {
            base = "(SELECT 1) base";
            leafExpr = String(rootId);
        } else {
            const h0 = opts.hops[0] as TraverseHop;
            const from0 = h0.direction === "out" ? C.subject : C.object;
            const to0 = h0.direction === "out" ? C.object : C.subject;
            base = `${T.edges} e0`;
            wheres.push(`e0.${from0} = ${rootId}`);
            wheres.push(`e0.${C.predicate} = ${hopPredIds[0]}`);
            wheres.push(scope("e0"));
            leafExpr = `e0.${to0}`;
            for (let i = 1; i < opts.hops.length; i++) {
                const h = opts.hops[i] as TraverseHop;
                const from = h.direction === "out" ? C.subject : C.object;
                const to = h.direction === "out" ? C.object : C.subject;
                const a = `e${i}`;
                joins.push(
                    `JOIN ${T.edges} ${a} ON ${a}.${from} = ${leafExpr} AND ` +
                        `${a}.${C.predicate} = ${hopPredIds[i]} AND ${scope(a)}`,
                );
                leafExpr = `${a}.${to}`;
            }
        }

        // Leaf constraints: rdf:type and property-equality, each an extra join.
        let cIdx = 0;
        if (opts.leafType) {
            const rdfTypeId = await this._nodeId(ctx, makeIRI(RDF_TYPE) as RdfTerm);
            const typeId = await this._nodeId(ctx, opts.leafType as RdfTerm);
            if (rdfTypeId === null || typeId === null) {
                return [];
            }
            const a = `c${cIdx++}`;
            joins.push(
                `JOIN ${T.edges} ${a} ON ${a}.${C.subject} = ${leafExpr} AND ` +
                    `${a}.${C.predicate} = ${rdfTypeId} AND ${a}.${C.object} = ${typeId} AND ${scope(a)}`,
            );
        }
        for (const eq of opts.leafEq ?? []) {
            const pid = await this._nodeId(ctx, eq.predicate as RdfTerm);
            const oid = await this._nodeId(ctx, eq.object as RdfTerm);
            if (pid === null || oid === null) {
                return [];
            }
            const a = `c${cIdx++}`;
            joins.push(
                `JOIN ${T.edges} ${a} ON ${a}.${C.subject} = ${leafExpr} AND ` +
                    `${a}.${C.predicate} = ${pid} AND ${a}.${C.object} = ${oid} AND ${scope(a)}`,
            );
        }

        const whereClause = wheres.length > 0 ? ` WHERE ${wheres.join(" AND ")}` : "";
        const sql = `SELECT DISTINCT ${leafExpr} AS leaf FROM ${base} ${joins.join(" ")}${whereClause}`;
        const raw = await this._db(ctx).raw(sql);
        const rows = (Array.isArray(raw) ? raw : raw.rows) as Array<{ leaf: number }>;
        return this._idsToIris(
            ctx,
            rows.map((r) => Number(r.leaf)),
        );
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
        const [ns, no, ne, net] = await Promise.all([
            this._db(ctx)(T.namespaces).count<[{ count: number }]>(`${C.id} as count`),
            this._db(ctx)(T.nodes).count<[{ count: number }]>(`${C.id} as count`),
            this._db(ctx)(T.edges)
                .where(C.isDeleted, false)
                .count<[{ count: number }]>(`${C.id} as count`),
            this._db(ctx)(T.edges).count<[{ count: number }]>(`${C.id} as count`),
        ]);
        return {
            namespaces: Number(ns[0].count),
            nodes: Number(no[0].count),
            edges: Number(ne[0].count),
            edgesTotal: Number(net[0].count),
        };
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private async _nodeId(ctx: ServerContext, term: RdfTerm): Promise<number | null> {
        if (isIRI(term)) {
            const node = await this._db(ctx)(T.nodes)
                .where({ [C.kind]: "iri", [C.iri]: term.value })
                .first<NodeRow>();
            return node?.id ?? null;
        }

        if (term.termType === "BlankNode") {
            const node = await this._db(ctx)(T.nodes)
                .where({ [C.kind]: "blank", [C.blankId]: term.id })
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
                [C.dt]: dtIri,
                [C.lang]: term.language ?? null,
            })
            .first<NodeRow>();
        return node?.id ?? null;
    }

    /**
     * Resolves a graph term to its node ID.
     * `null` input means "default graph" → looks up urn:sys:graph:default.
     * Returns null if the graph has never been interned (no matching quads).
     */
    private async _resolveGraph(ctx: ServerContext, graph: IRI | null): Promise<number | null> {
        const gTerm = graph === null ? DEFAULT_GRAPH_NODE : graph;
        return this._nodeId(ctx, gTerm);
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
        graphId?: number;
    } | null> {
        const result: {
            subject?: number;
            predicate?: number;
            object?: number;
            graphId?: number;
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
            const id = await this._resolveGraph(ctx, pattern.graph);
            if (id === null) {
                return null;
            }
            result.graphId = id;
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
            q = q.where(C.graph, ids.graphId);
        }
        return q;
    }

    private async _hydrateEdges(ctx: ServerContext, edges: EdgeRow[]): Promise<Quad[]> {
        const nodeIds = new Set<number>();
        for (const e of edges) {
            nodeIds.add(e.subject);
            nodeIds.add(e.predicate);
            nodeIds.add(e.object);
            nodeIds.add(e.graph);
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
            const graph = this._graphTermFromNode(nodeMap.get(e.graph));
            return {
                subject: subject as IRI | BlankNode,
                predicate: predicate as IRI,
                object: object as RdfTerm,
                graph,
            };
        });
    }

    /**
     * Converts a graph node from the node map to the appropriate Quad graph term.
     * The well-known default graph IRI is mapped back to the DEFAULT_GRAPH sentinel.
     */
    private _graphTermFromNode(node: RdfTerm | undefined): IRI | DefaultGraph {
        if (node == null || !isIRI(node)) {
            // Defensive fallback — graph column is always set to a non-null IRI node.
            /* v8 ignore next */
            return DEFAULT_GRAPH satisfies DefaultGraph;
        }
        if ((node as IRI).value === DEFAULT_GRAPH_IRI) {
            return DEFAULT_GRAPH satisfies DefaultGraph;
        }
        return node as IRI;
    }

    private async _loadNodes(ctx: ServerContext, ids: number[]): Promise<Map<number, RdfTerm>> {
        /* v8 ignore next */
        if (ids.length === 0) {
            return new Map();
        }
        const nodes = await this._db(ctx)(T.nodes).whereIn(C.id, ids).select<NodeRow[]>("*");
        /* v8 ignore next */
        return new Map(nodes.map((n) => [n.id, nodeToTerm(n)]));
    }
}
