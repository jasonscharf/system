import { type ApplicationContext, defaultCtx, type UserSession } from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { EntitySchema } from "@jasonscharf/entities";
import type { Knex } from "knex";
import { EntityQuery } from "./EntityQuery.js";

export type EntityLookup = <Props extends Record<string, unknown>>(
    schema: EntitySchema<Props>,
) => EntityQuery<Props>;

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
     * (http://tern.dev/ns/tenant/{tenantId}).  Absent means DEFAULT_GRAPH.
     */
    tenantId?: string;
    /** The underlying quad store for this context. */
    store: TripleStore;
    /**
     * Typed entity query builder.
     * Usage: ctx.entities(MySchema).where('field', '=', value).first(ctx)
     */
    entities: EntityLookup;
}

/**
 * Build a ServerContext bound to the given store.
 * Pass optional base fields (trx, tenantId, session, etc.) as the second arg.
 */
export function buildServerContext(
    store: TripleStore,
    base: Partial<Omit<ServerContext, "entities" | "store">> = {},
): ServerContext {
    return {
        bus: defaultCtx.bus,
        ...base,
        store,
        entities: (schema) => new EntityQuery(store, schema),
    };
}
