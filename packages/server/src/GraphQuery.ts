import type { IRI } from "@jasonscharf/core";
import type { TraverseHop, TripleStore } from "@jasonscharf/data";
import type { EntityRecord, EntitySchema, FilterOp } from "@jasonscharf/entities";
import { entityIriFor, toLiteral } from "@jasonscharf/entities";
import { type EntityInput, EntityStore } from "./EntityStore.js";
import { AccessChecker } from "./rbac/AccessChecker.js";
import { PolicyGrantRepository } from "./rbac/repository/PolicyGrantRepository.js";
import type { SecurityContext } from "./SecurityContext.js";
import type { ServerContext } from "./ServerContext.js";
import { TenantSchema } from "./tenancy/schemas.js";
import { tenantGraph } from "./tenancy.js";
import { scopeChainFor } from "./topology.js";

/** A parent to attach a newly created entity under, so it is reachable by construction. */
export interface AttachUnder {
    schema: EntitySchema;
    id: string;
    edge: string;
}

interface Where {
    prop: string;
    op: FilterOp;
    value: unknown;
}

/**
 * The one way to query domain objects: a rooted graph traversal.
 *
 * Every query is anchored at the caller's **tenant root** and walks the topology
 * outward (tenant → org → member → …) as a chain of edge joins. A leaf is
 * returned only when the full root→leaf path exists in the tenant's graph — there
 * is no flat "find all of type X". This is both the isolation guarantee (a node
 * not attached under the tenant is unreachable) and the substrate for RBAC, where
 * each hop is an authorization boundary.
 *
 * Obtained via `ctx.graph(sec)`. Building blocks: `.out(edge)`, `.in(edge)`,
 * `.where(prop, op, value)`, `.orderBy`, `.limit`, `.offset`. Terminals:
 * `.all(Schema)`, `.first(Schema)`, `.ids(Schema)`, `.count(Schema)`.
 */
export class GraphQuery {
    private readonly _ctx: ServerContext;
    private readonly _sec: SecurityContext;
    private readonly _store: TripleStore;
    private readonly _root: IRI | null;
    private readonly _graph: IRI | null;
    private _current?: EntitySchema;
    private _checker?: AccessChecker;
    private readonly _hops: TraverseHop[] = [];
    private readonly _wheres: Where[] = [];
    private _order?: { prop: string; dir: "asc" | "desc" };
    private _limit?: number;
    private _offset?: number;

    constructor(ctx: ServerContext, sec: SecurityContext) {
        this._ctx = ctx;
        this._sec = sec;
        this._store = ctx.store;
        // Root every query at the caller's tenant. No tenant on ctx ⇒ no domain
        // data is reachable (root stays null and terminals return empty).
        this._root = ctx.tenantId ? entityIriFor(TenantSchema, ctx.tenantId) : null;
        this._graph = tenantGraph(ctx);
        this._current = TenantSchema;
    }

    /** Follow an outward edge (current --edge--> next) by its schema edge name. */
    out(edgeName: string): this {
        return this._hop(edgeName, "out");
    }

    /** Follow an inbound edge (next --edge--> current) by its schema edge name. */
    in(edgeName: string): this {
        return this._hop(edgeName, "in");
    }

    private _hop(edgeName: string, direction: "out" | "in"): this {
        const def = this._current?.edges?.[edgeName];
        if (!def) {
            throw new Error(`GraphQuery.${direction}: no edge "${edgeName}" on the current node`);
        }
        this._hops.push({ predicate: def.predicate, direction });
        this._current = def.target?.();
        return this;
    }

    where(prop: string, op: FilterOp, value: unknown): this {
        this._wheres.push({ prop, op, value });
        return this;
    }

    orderBy(prop: string, dir: "asc" | "desc" = "asc"): this {
        this._order = { prop, dir };
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

    /** The leaf IRIs reachable via the full rooted path, with `=` filters pushed into SQL. */
    async ids<Props extends Record<string, unknown>>(
        leafSchema: EntitySchema<Props>,
    ): Promise<string[]> {
        if (this._root === null) {
            return [];
        }
        const props = leafSchema.properties as Record<string, IRI>;
        const leafEq = this._wheres
            .filter((w) => w.op === "=")
            .map((w) => {
                const predicate = props[w.prop];
                if (!predicate) {
                    throw new Error(`GraphQuery.where: "${w.prop}" is not a property of the leaf`);
                }
                return { predicate, object: toLiteral(w.value) };
            });
        const iris = await this._store.rootedTraverse(this._ctx, {
            root: this._root,
            hops: this._hops,
            graph: this._graph,
            leafType: leafSchema.typeIRI,
            leafEq,
        });
        return iris.map((i) => i.value);
    }

    /** Hydrated, tenant-scoped records for the reachable leaves. */
    async all<Props extends Record<string, unknown>>(
        leafSchema: EntitySchema<Props>,
    ): Promise<EntityRecord<Props>[]> {
        const iris = await this.ids(leafSchema);
        let records = await new EntityStore(this._store).hydrateMany(this._ctx, leafSchema, iris);

        for (const w of this._wheres) {
            if (w.op !== "=") {
                records = records.filter((r) => matchFilter(r.props[w.prop], w.op, w.value));
            }
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
    }

    async first<Props extends Record<string, unknown>>(
        leafSchema: EntitySchema<Props>,
    ): Promise<EntityRecord<Props> | null> {
        const records = await this.limit(1).all(leafSchema);
        return records[0] ?? null;
    }

    async count<Props extends Record<string, unknown>>(
        leafSchema: EntitySchema<Props>,
    ): Promise<number> {
        return (await this.ids(leafSchema)).length;
    }

    // ── Secure mutations ──────────────────────────────────────────────────────
    // A privileged write cannot be issued without `requires`: the permission is
    // asserted against the entity's scope chain (resolved over the containment
    // topology) before the write happens. The secure path IS the only path.

    /**
     * Create `data` and attach it under a parent so it is reachable by construction.
     * Authorizes `opts.requires` against the parent's scope chain (or the tenant root
     * when no parent is given).
     */
    async create<Props extends Record<string, unknown>>(
        schema: EntitySchema<Props>,
        data: EntityInput<Props>,
        opts: { requires: string; under?: AttachUnder },
    ): Promise<EntityRecord<Props>> {
        // The assert + create + attach-under-parent are ONE unit of work: a crash
        // between create and addEdge would otherwise leave an entity that is not
        // attached under its parent and therefore permanently unreachable in the
        // rooted-traversal model. withTransaction is reentrant, so this also joins
        // an ambient transaction when the caller already opened one (ctx.tx).
        return this._store.withTransaction(this._ctx, async (txCtx) => {
            const anchor = opts.under
                ? entityIriFor(opts.under.schema, opts.under.id).value
                : (this._root?.value ?? "");
            await this._assert(txCtx, opts.requires, anchor);
            const es = new EntityStore(this._store);
            const rec = await es.create<Props>(txCtx, schema, data);
            if (opts.under) {
                await es.addEdge(txCtx, opts.under.schema, opts.under.id, opts.under.edge, rec.iri);
            }
            return rec;
        });
    }

    /** Update an entity after asserting `opts.requires` over its scope chain. */
    async update<Props extends Record<string, unknown>>(
        schema: EntitySchema<Props>,
        id: string,
        patch: EntityInput<Props>,
        opts: { requires: string },
    ): Promise<void> {
        await this._store.withTransaction(this._ctx, async (txCtx) => {
            await this._assert(txCtx, opts.requires, entityIriFor(schema, id).value);
            await new EntityStore(this._store).update(txCtx, schema, id, patch);
        });
    }

    /** Delete an entity after asserting `opts.requires` over its scope chain. */
    async delete(schema: EntitySchema, id: string, opts: { requires: string }): Promise<void> {
        await this._store.withTransaction(this._ctx, async (txCtx) => {
            await this._assert(txCtx, opts.requires, entityIriFor(schema, id).value);
            await new EntityStore(this._store).delete(txCtx, schema, id);
        });
    }

    private _accessChecker(): AccessChecker {
        if (!this._checker) {
            this._checker = new AccessChecker(this._store, new PolicyGrantRepository(this._store));
        }
        return this._checker;
    }

    /** Assert `permission` for the caller over `entityIri`'s containment scope chain. */
    private async _assert(
        ctx: ServerContext,
        permission: string,
        entityIri: string,
    ): Promise<void> {
        const principal = this._sec.principalIri;
        if (principal === null) {
            throw new Error(`Access denied: anonymous lacks "${permission}".`);
        }
        const scopeChain = await scopeChainFor(ctx, entityIri);
        const allowed = await this._accessChecker().check(ctx, {
            principal,
            permission,
            scopeChain,
            actingAs: this._sec.isImpersonating ? this._sec.actingAsIri : undefined,
        });
        if (!allowed) {
            throw new Error(`Access denied: "${principal}" lacks "${permission}".`);
        }
    }
}

function matchFilter(value: unknown, op: FilterOp, target: unknown): boolean {
    switch (op) {
        case "!=":
            return value !== target;
        case "<":
            return (value as number) < (target as number);
        case "<=":
            return (value as number) <= (target as number);
        case ">":
            return (value as number) > (target as number);
        case ">=":
            return (value as number) >= (target as number);
        case "LIKE":
        case "ILIKE": {
            const pat = String(target).replace(/%/g, ".*").replace(/_/g, ".");
            const flags = op === "ILIKE" ? "i" : "";
            return typeof value === "string" && new RegExp(`^${pat}$`, flags).test(value);
        }
        default:
            return false;
    }
}
