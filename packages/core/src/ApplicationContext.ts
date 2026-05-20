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
 * Platform-wide application context passed to every operation.
 * Extended by ServerContext (adds a Knex transaction) for database operations.
 *
 * Use module augmentation to add application-specific fields:
 *
 *   declare module '@system/core' {
 *     interface ApplicationContext {
 *       tenantId?: string;
 *     }
 *   }
 */
export interface ApplicationContext {
    logger?: Logger;
    config?: Record<string, unknown>;
}

/** Named empty context — no logger, no config. */
export const noCtx: ApplicationContext = Object.freeze({});
