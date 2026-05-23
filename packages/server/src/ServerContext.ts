import type { Knex } from 'knex';
import type { ApplicationContext, UserSession } from '@jasonscharf/core';


export interface ServerContext extends ApplicationContext {
    trx?: Knex.Transaction;
    session?: UserSession;
}

export const defaultServerContext: ServerContext = Object.freeze({});
