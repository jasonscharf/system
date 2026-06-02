import { type ApplicationContext, defaultCtx, type UserSession } from "@jasonscharf/core";
import type { Knex } from "knex";

export interface ServerContext extends ApplicationContext {
    trx?: Knex.Transaction;
    session?: UserSession;
    /**
     * When set, all EntityStore reads and writes are scoped to the named
     * tenant graph (http://tern.dev/ns/tenant/{tenantId}).  Absent means
     * DEFAULT_GRAPH — preserving backwards compatibility with un-tenanted code.
     */
    tenantId?: string;
}

export const defaultServerContext: ServerContext = Object.freeze({
    bus: defaultCtx.bus,
});
