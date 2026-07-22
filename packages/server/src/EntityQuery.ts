import type { IRI } from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { EntityRecord, EntitySchema, FilterOp, IFieldCipher } from "@jasonscharf/entities";
import { RDF_TYPE, toLiteral } from "@jasonscharf/entities";
import {
    type EdgeInput,
    type EntityInput,
    type EntityStore,
    edgeTargetIri,
} from "./EntityStore.js";
import { createEntityStore } from "./EntityStoreFactory.js";
import type { ServerContext } from "./ServerContext.js";
import { tenantGraph } from "./tenancy.js";

export type { FilterOp };

interface Filter {
    prop: string;
    op: FilterOp;
    value: unknown;
}

/** An edge-equality filter: entity --edge--> targetIri. */
interface EdgeFilter {
    edgeName: string;
    targetIri: string;
}

/** An edge-membership filter: entity --edge--> any of targetIris. */
interface EdgeAnyFilter {
    edgeName: string;
    targetIris: string[];
}

/** A subtree-membership filter: entity is reachable from rootIri via the edge's predicate. */
interface WithinFilter {
    edgeName: string;
    rootIri: string;
}

interface OrderClause {
    prop: string;
    dir: "asc" | "desc";
}

export class EntityQuery<Props extends Record<string, unknown>> {
    private readonly _es: EntityStore;
    private _filters: Filter[] = [];
    private _edgeFilters: EdgeFilter[] = [];
    private _edgeAnyFilters: EdgeAnyFilter[] = [];
    private _withinFilters: WithinFilter[] = [];
    private _order?: OrderClause;
    private _limit?: number;
    private _offset?: number;
    private _acrossTenants = false;

    constructor(
        private readonly _store: TripleStore,
        private readonly _schema: EntitySchema<Props>,
        cipher?: IFieldCipher,
    ) {
        // The cipher (when supplied) flows to the inner EntityStore so that
        // hydrating PII-bearing records decrypts them, matching ctx.cipher
        // semantics for callers that wire the cipher at construction instead.
        this._es = createEntityStore(_store, undefined, cipher);
    }

    where(prop: keyof Props & string, op: FilterOp, value: unknown): this {
        this._filters.push({ prop, op, value });
        return this;
    }

    /**
     * Read across EVERY tenant graph instead of the caller's own — the
     * sanctioned escape hatch for system surfaces (superuser dashboards,
     * install-wide metrics) whose whole point is a cross-tenant view.  The
     * caller is responsible for gating access (e.g. behind a superuser guard);
     * request paths must never use this — they stay scoped to ctx.tenantId
     * (TRN-531).  Scans and hydration omit the graph filter entirely.
     */
    acrossTenants(): this {
        this._acrossTenants = true;
        return this;
    }

    orderBy(prop: keyof Props & string, dir: "asc" | "desc" = "asc"): this {
        this._order = { prop, dir };
        return this;
    }

    /**
     * Filter to entities whose `edge` points at `target` (an id, IRI, or record).
     * This is the topological replacement for `.where('fooId', '=', …)` — it
     * matches on the IRI-object edge, not a foreign-key scalar.
     */
    connectedTo(edge: string, target: EdgeInput): this {
        const def = this._schema.edges?.[edge];
        if (!def) {
            throw new Error(`EntityQuery.connectedTo: schema has no edge "${edge}"`);
        }
        this._edgeFilters.push({
            edgeName: edge,
            targetIri: edgeTargetIri(target, def.target?.()),
        });
        return this;
    }

    /**
     * Filter to entities whose `edge` points at ANY of `targets` — the reverse
     * batched form of connectedTo (e.g. grants whose hasPrincipal is in a
     * principal set).  Evaluated in one query, not a per-target loop.
     */
    connectedToAny(edge: string, targets: EdgeInput[]): this {
        const def = this._schema.edges?.[edge];
        if (!def) {
            throw new Error(`EntityQuery.connectedToAny: schema has no edge "${edge}"`);
        }
        // Always record the filter, even when empty: "connected to any of nothing"
        // matches nothing (rather than degrading to no filter / match-all).
        this._edgeAnyFilters.push({
            edgeName: edge,
            targetIris: targets.map((t) => edgeTargetIri(t, def.target?.())),
        });
        return this;
    }

    /**
     * Filter to entities that lie within the subtree rooted at `root`, following
     * the given `edge`'s predicate (e.g. `.within('parent', folderId)` returns the
     * folder and everything transitively under it).  Evaluated as one recursive CTE.
     */
    within(edge: string, root: EdgeInput): this {
        const def = this._schema.edges?.[edge];
        if (!def) {
            throw new Error(`EntityQuery.within: schema has no edge "${edge}"`);
        }
        this._withinFilters.push({ edgeName: edge, rootIri: edgeTargetIri(root, def.target?.()) });
        return this;
    }

    limit(n: number): this {
        this._limit = n;
        return this;
    }

    offset(n: number): this {
        this._offset = n;
        return this;
    }

    async all(ctx: ServerContext): Promise<EntityRecord<Props>[]> {
        return this._store.withTransaction(ctx, async (txCtx) => {
            const candidateIris = await this._narrow(txCtx);

            const otherFilters = this._filters.filter((f) => f.op !== "=");

            let records = await this._es.hydrateMany(txCtx, this._schema, candidateIris, {
                acrossTenants: this._acrossTenants,
            });

            for (const f of otherFilters) {
                records = records.filter((r) => this._matchFilter(r, f));
            }

            if (this._order) {
                const { prop, dir } = this._order;
                records.sort((a, b) => {
                    const av = a.props[prop];
                    const bv = b.props[prop];
                    if (av === bv) {
                        return 0;
                    }
                    const cmp = av == null ? -1 : bv == null ? 1 : av < bv ? -1 : 1;
                    return dir === "asc" ? cmp : -cmp;
                });
            }

            const start = this._offset ?? 0;
            const end = this._limit !== undefined ? start + this._limit : undefined;
            return records.slice(start, end);
        });
    }

    async first(ctx: ServerContext): Promise<EntityRecord<Props> | null> {
        const results = await this.limit(1).all(ctx);
        return results[0] ?? null;
    }

    async count(ctx: ServerContext): Promise<number> {
        return this._store.withTransaction(ctx, async (txCtx) => {
            const iris = await this._narrow(txCtx);
            return iris.length;
        });
    }

    async create(ctx: ServerContext, data: EntityInput<Props>): Promise<EntityRecord<Props>> {
        return this._es.create(ctx, this._schema, data);
    }

    async save(ctx: ServerContext, record: EntityRecord<Props>): Promise<void> {
        return this._es.update(ctx, this._schema, record.id, record.props);
    }

    async delete(ctx: ServerContext, id: string): Promise<void> {
        return this._es.delete(ctx, this._schema, id);
    }

    get store(): TripleStore {
        return this._store;
    }

    // ── Static / free function ────────────────────────────────────────────────

    /** Convenience: start a query from a raw store (no ctx required at this point). */
    static from<Props extends Record<string, unknown>>(
        store: TripleStore,
        schema: EntitySchema<Props>,
        cipher?: IFieldCipher,
    ): EntityQuery<Props> {
        return new EntityQuery(store, schema, cipher);
    }

    // ── Private ───────────────────────────────────────────────────────────────

    /**
     * Narrows the entity set by every server-side filter (equality, edge, and
     * subtree) and returns the surviving IRIs.  Shared by all() and count().
     */
    private async _narrow(ctx: ServerContext): Promise<string[]> {
        let iris = await this._allEntityIris(ctx);
        for (const f of this._filters.filter((ff) => ff.op === "=")) {
            iris = await this._applyEqFilter(ctx, iris, f);
        }
        for (const ef of this._edgeFilters) {
            iris = await this._applyEdgeFilter(ctx, iris, ef);
        }
        for (const ef of this._edgeAnyFilters) {
            iris = await this._applyEdgeAnyFilter(ctx, iris, ef);
        }
        for (const wf of this._withinFilters) {
            iris = await this._applyWithinFilter(ctx, iris, wf);
        }
        return iris;
    }

    /**
     * The graph every flat type scan runs in: a schema's fixed graphIri wins,
     * otherwise the caller's tenant graph (null ⇒ DEFAULT_GRAPH).  Mirrors
     * EntityStore._filterGraph so a query and its store agree on scope; without
     * it a scan reads across every tenant and leaks foreign rows (TRN-531).
     * In acrossTenants() mode the filter is omitted entirely (all graphs).
     */
    private _scanGraph(ctx: ServerContext): IRI | null | undefined {
        if (this._acrossTenants) {
            return undefined;
        }
        return this._schema.graphIri ?? tenantGraph(ctx, this._schema.graph);
    }

    private async _allEntityIris(ctx: ServerContext): Promise<string[]> {
        const quads = await this._store.find(ctx, {
            predicate: RDF_TYPE,
            object: this._schema.typeIRI,
            graph: this._scanGraph(ctx),
        });
        return quads.map((q) => (q.subject as IRI).value);
    }

    /** Narrows to entities that have an out-edge pointing at the target IRI. */
    private async _applyEdgeFilter(
        ctx: ServerContext,
        iris: string[],
        f: EdgeFilter,
    ): Promise<string[]> {
        const def = this._schema.edges?.[f.edgeName];
        /* v8 ignore next 3 -- guarded at connectedTo() call time */
        if (!def) {
            return iris;
        }
        const edgeQuads = await this._store.find(ctx, {
            predicate: def.predicate,
            object: { value: f.targetIri } as IRI,
            graph: this._scanGraph(ctx),
        });
        const matching = new Set(edgeQuads.map((q) => (q.subject as IRI).value));
        return iris.filter((iri) => matching.has(iri));
    }

    /** Narrows to entities whose edge points at any IRI in the target set (one query). */
    private async _applyEdgeAnyFilter(
        ctx: ServerContext,
        iris: string[],
        f: EdgeAnyFilter,
    ): Promise<string[]> {
        const def = this._schema.edges?.[f.edgeName];
        /* v8 ignore next 3 -- guarded at connectedToAny() call time */
        if (!def) {
            return iris;
        }
        // Empty target set ⇒ nothing qualifies; skip the query entirely.
        if (f.targetIris.length === 0) {
            return [];
        }
        const targetSet = new Set(f.targetIris);
        const edgeQuads = await this._store.find(ctx, {
            predicate: def.predicate,
            graph: this._scanGraph(ctx),
        });
        const matching = new Set(
            edgeQuads
                .filter((q) => targetSet.has((q.object as IRI).value))
                .map((q) => (q.subject as IRI).value),
        );
        return iris.filter((iri) => matching.has(iri));
    }

    /** Narrows to entities within the subtree rooted at rootIri (one recursive CTE). */
    private async _applyWithinFilter(
        ctx: ServerContext,
        iris: string[],
        f: WithinFilter,
    ): Promise<string[]> {
        const def = this._schema.edges?.[f.edgeName];
        /* v8 ignore next 3 -- guarded at within() call time */
        if (!def) {
            return iris;
        }
        // Descendants of the root: follow the edge predicate inbound (child --edge--> parent).
        const subtree = await this._store.reachable(ctx, {
            roots: [{ value: f.rootIri } as IRI],
            predicates: [def.predicate],
            direction: "in",
            graph: this._scanGraph(ctx),
        });
        const subtreeSet = new Set(subtree.map((i) => i.value));
        return iris.filter((iri) => subtreeSet.has(iri));
    }

    private async _applyEqFilter(ctx: ServerContext, iris: string[], f: Filter): Promise<string[]> {
        const propIri = (this._schema.properties as Record<string, IRI>)[f.prop];
        if (!propIri) {
            return iris;
        }

        const valueNode = toLiteral(f.value);
        const propQuads = await this._store.find(ctx, {
            predicate: propIri,
            object: valueNode,
            graph: this._scanGraph(ctx),
        });
        const matchingEntities = new Set(propQuads.map((q) => (q.subject as IRI).value));

        return iris.filter((iri) => matchingEntities.has(iri));
    }

    private _matchFilter(record: EntityRecord<Props>, f: Filter): boolean {
        const value = record.props[f.prop];
        switch (f.op) {
            case "!=":
                return value !== f.value;
            case "<":
                return (value as number) < (f.value as number);
            case "<=":
                return (value as number) <= (f.value as number);
            case ">":
                return (value as number) > (f.value as number);
            case ">=":
                return (value as number) >= (f.value as number);
            case "LIKE":
            case "ILIKE": {
                const pat = String(f.value).replace(/%/g, ".*").replace(/_/g, ".");
                const flags = f.op === "ILIKE" ? "i" : "";
                return typeof value === "string" && new RegExp(`^${pat}$`, flags).test(value);
            }
            default:
                return false;
        }
    }
}
