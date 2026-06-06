import { type ApplicationContext, defaultCtx, type UserSession } from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { EntityRecord, EntitySchema } from "@jasonscharf/entities";
import type { Knex } from "knex";
import { EntityQuery } from "./EntityQuery.js";
import { EntityStore } from "./EntityStore.js";

export type EntityLookup = <Props extends Record<string, unknown>>(
    schema: EntitySchema<Props>,
) => EntityQuery<Props>;

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
     * (urn:tern:core:tenant:{tenantId}).  Absent means DEFAULT_GRAPH.
     */
    tenantId?: string;
    /** The underlying quad store for this context. */
    store: TripleStore;
    /**
     * Typed entity query builder.
     * Usage: ctx.entities(MySchema).where('field', '=', value).first(ctx)
     */
    entities: EntityLookup;
    /**
     * Batched edge traversal across many records (no N+1).
     * Usage: const byId = await ctx.related(experiments, ExperimentSchema, 'domain')
     */
    related: RelatedLookup;
}

/**
 * Build a ServerContext bound to the given store.
 * Pass optional base fields (trx, tenantId, session, etc.) as the second arg.
 */
export function buildServerContext(
    store: TripleStore,
    base: Partial<Omit<ServerContext, "entities" | "store">> = {},
): ServerContext {
    const ctx: ServerContext = {
        bus: defaultCtx.bus,
        ...base,
        store,
        entities: (schema) => new EntityQuery(store, schema),
        related: (sources, schema, edgeName) =>
            new EntityStore(store).related(ctx, sources, schema, edgeName),
    };
    return ctx;
}
