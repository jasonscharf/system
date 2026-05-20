import type { Knex } from 'knex';
import type { ApplicationContext, Logger } from '@jasonscharf/core';

// Re-export core types so callers can import everything from @system/data
export type { ApplicationContext, Logger };
export { noCtx } from '@jasonscharf/core';

/**
 * Server-side context — extends ApplicationContext with an optional Knex
 * transaction.  Pass one from `store.withTransaction()` to chain multiple
 * DB writes atomically.  When absent, each call creates + commits its own
 * transaction automatically.
 */
export interface ServerContext extends ApplicationContext {
    trx?: Knex.Transaction;
}

/** Named empty server context — no transaction, no logger, no config. */
export const defaultCtx: ServerContext = Object.freeze({});
