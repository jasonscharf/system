import type { Knex } from 'knex';


/**
 * Minimal logger interface.  Any logger satisfying this shape (pino, winston,
 * console-based, etc.) can be placed on ApplicationContext.
 */
export interface Logger {
    debug(msg: string, meta?: Record<string, unknown>): void;
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
}

/**
 * Platform-wide application context passed to every database write operation.
 *
 * `trx`    — an active Knex transaction; the store creates + commits one
 *             automatically when absent.  Pass one from `store.withTransaction()`
 *             to chain multiple writes atomically.
 *
 * `logger` — optional structured logger.
 *
 * `config` — arbitrary application configuration.  Use module augmentation
 *             to extend this type in your application:
 *
 *             declare module '@system/data' {
 *               interface ApplicationContext {
 *                 config?: { tenantId: string; analyticsEnabled: boolean };
 *               }
 *             }
 */
export interface ApplicationContext {
    trx?:    Knex.Transaction;
    logger?: Logger;
    config?: Record<string, unknown>;
}

/** Named empty context — no transaction, no logger, no config. */
export const noCtx: ApplicationContext = Object.freeze({});
