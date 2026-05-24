import type { ApplicationContext, UserSession } from "@jasonscharf/core";
import type { Knex } from "knex";

export interface ServerContext extends ApplicationContext {
    trx?: Knex.Transaction;
    session?: UserSession;
}

export const defaultServerContext: ServerContext = Object.freeze({});
