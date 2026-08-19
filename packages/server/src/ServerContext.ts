import {
    type ApplicationContext,
    defaultCtx,
    type IRI,
    tryResolveService,
    type UserSession,
} from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { EntityRecord, EntitySchema, IFieldCipher } from "@jasonscharf/entities";
import type { Knex } from "knex";
import { EntityQuery } from "./EntityQuery.js";
import type { EntityStore } from "./EntityStore.js";
import { createEntityStore } from "./EntityStoreFactory.js";
import { GraphQuery } from "./GraphQuery.js";
import type { SecurityContext } from "./SecurityContext.js";
import { FieldCipherService } from "./services.js";
import { CORE_CONTAINMENT_SCHEMAS, containmentPredicatesOf } from "./topology.js";

export type EntityLookup = <Props extends Record<string, unknown>>(
    schema: EntitySchema<Props>,
) => EntityQuery<Props>;

/**
 * The one way to query domain objects: a rooted graph traversal anchored at the
 * caller's tenant. Usage: `ctx.graph(sec).out('org').out('member').all(UserSchema)`.
 */
export type GraphLookup = (sec: SecurityContext) => GraphQuery;

/**
 * Batched edge traversal: load the entities across `edgeName` for many source
 * records in one round-trip, grouped by source id.  The no-N+1 way to walk a
 * level of the graph.
 */
export type RelatedLookup = <Target extends Record<string, unknown>>(
    sources: EntityRecord[],
    schema: EntitySchema,
    edgeName: string,
) => Promise<Map<string, EntityRecord<Target>[]>>;

/**
 * Server context — passed to every system operation.
 *
 * Always constructed via buildServerContext(store, base?).
 * Every ServerContext carries the store and typed entity builder; there are
 * no partial or store-less server contexts.
 */
export interface ServerContext extends ApplicationContext {
    trx?: Knex.Transaction;
    session?: UserSession;
    /**
     * When set, reads/writes are scoped to the named tenant graph
     * (urn:sys:core:tenant:{tenantId}).  Absent means DEFAULT_GRAPH.
     */
    tenantId?: string;
    /** The underlying quad store for this context. */
    store: TripleStore;
    /**
     * Field cipher for at-rest PII.  When present, EntityStore encrypts
     * `pii`-flagged properties before insert and decrypts them on read; raw
     * TripleStore access still returns ciphertext.  Absent ⇒ no PII property may
     * be written (EntityStore throws) — encryption is the default at rest, never
     * silently skipped.  Built from SecretsManager at app startup.
     */
    cipher?: IFieldCipher;
    /**
     * Typed entity query builder (flat, un-rooted — being superseded by `graph`).
     * Usage: ctx.entities(MySchema).where('field', '=', value).first(ctx)
     * @deprecated Use `ctx.graph(sec)` — every domain query must traverse from the
     * tenant root, which this builder does not enforce.
     */
    entities: EntityLookup;
    /**
     * The one rooted-traversal query entry point.
     * Usage: ctx.graph(sec).out('org').out('member').where('email','=',e).all(UserSchema)
     */
    graph: GraphLookup;
    /**
     * Batched edge traversal across many records (no N+1).
     * Usage: const byId = await ctx.related(experiments, ExperimentSchema, 'domain')
     */
    related: RelatedLookup;
    /**
     * The unit of work.  Runs `fn` inside a chainable (reentrant) transaction:
     * if this ctx already carries a `trx`, `fn` reuses it; otherwise a new
     * transaction is opened.  The ctx passed to `fn` carries the `trx` and a
     * fully-wired graph/entities/related/entityStore bound to it, so every
     * nested call is atomic by default and callers never reach for the raw store.
     * Usage: await ctx.tx(async (ctx) => { ...all calls share one transaction... })
     */
    tx<T>(fn: (ctx: ServerContext) => Promise<T>): Promise<T>;
    /**
     * EntityStore for this context with the field cipher pre-wired from `ctx`.
     * Use instead of `new EntityStore(ctx.store, undefined, ctx.cipher)` so PII
     * encryption can never be forgotten and the raw store stays an internal detail.
     */
    entityStore: EntityStore;
    /**
     * The containment predicates that define this context's authorization scope
     * chain — the edges `scopeChainFor` walks up from a resource to the tenant
     * root. Derived once at build time from the core backbone plus any extension
     * `schemas`, so the chain never depends on module import order (TRN-627).
     */
    containment: readonly IRI[];
}

/**
 * Base fields accepted by buildServerContext.
 *
 * `containment` is derived, never passed: it is always composed from the core
 * backbone plus `schemas`, so no caller can build a context whose scope chain
 * omits the tenant root.
 */
export type ServerContextBase = Partial<
    Omit<
        ServerContext,
        "entities" | "store" | "graph" | "related" | "tx" | "entityStore" | "containment"
    >
> & {
    /**
     * Extension schemas whose `containment: true` edges extend the tenant-rooted
     * topology for this context (e.g. Forum --hasPost--> Post). The core tenancy
     * backbone is always included and cannot be dropped.
     */
    schemas?: readonly EntitySchema[];
};

/**
 * Build a ServerContext bound to the given store.
 * Pass optional base fields (trx, tenantId, session, etc.) as the second arg.
 */
export function buildServerContext(
    store: TripleStore,
    base: ServerContextBase = {},
): ServerContext {
    // Members resolve from the IoC container at build time (defaultCtx getters
    // and the FieldCipherService fallback), so bindService overrides installed
    // at boot are reflected by every context created afterwards. Explicit base
    // fields always win.
    const cipher = base.cipher ?? tryResolveService(FieldCipherService) ?? undefined;
    const ctx: ServerContext = {
        bus: defaultCtx.bus,
        logger: defaultCtx.logger,
        ...base,
        cipher,
        store,
        // Composed, not registered: the core backbone is always present, so the
        // scope chain reaches the tenant root no matter which module imported what.
        containment: containmentPredicatesOf([
            ...CORE_CONTAINMENT_SCHEMAS,
            ...(base.schemas ?? []),
        ]),
        entities: (schema) => new EntityQuery(store, schema),
        graph: (sec) => new GraphQuery(ctx, sec),
        related: (sources, schema, edgeName) =>
            createEntityStore(store, undefined, ctx.cipher).related(ctx, sources, schema, edgeName),
        // Eager: constructed before `ctx` is assigned (TDZ), so it reads the
        // resolved cipher, which equals ctx.cipher at build time.
        entityStore: createEntityStore(store, undefined, cipher),
        tx<T>(fn: (c: ServerContext) => Promise<T>): Promise<T> {
            if (ctx.trx) {
                return fn(ctx);
            }
            // Open a new transaction and hand `fn` a freshly-wired ctx whose
            // graph/entities/related/entityStore all bind to the new trx — not
            // withTransaction's shallow `{...ctx, trx}`, whose closures still
            // point at the trx-less parent.
            return store.withTransaction(ctx, (inner) =>
                fn(buildServerContext(store, { ...base, trx: inner.trx })),
            );
        },
    };
    return ctx;
}
