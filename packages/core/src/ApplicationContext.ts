import type { ServiceContainer } from "./container/index.js";

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
    /** Service container for typed dependency resolution across extensions. */
    services?: ServiceContainer;
}

/** Named empty context — no logger, no config. */
export const defaultCtx: ApplicationContext = Object.freeze({});
