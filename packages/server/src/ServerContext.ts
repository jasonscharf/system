import type { Knex } from 'knex';
import type { ApplicationContext } from '@jasonscharf/core';


export interface ServerContext extends ApplicationContext {
    trx?: Knex.Transaction;
}

export const defaultServerContext: ServerContext = Object.freeze({});
