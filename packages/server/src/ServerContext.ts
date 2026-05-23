import type { ApplicationContext } from "@jasonscharf/core";
import type { Knex } from "knex";

export interface ServerContext extends ApplicationContext {
    trx?: Knex.Transaction;
}

export const defaultServerContext: ServerContext = Object.freeze({});
