import { InMemorySystemBus } from "./bus/InMemorySystemBus.js";
import type { ISystemBus } from "./bus/ISystemBus.js";
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
 *   declare module '@jasonscharf/core' {
 *     interface ApplicationContext {
 *       tenantId?: string;
 *     }
 *   }
 */
export interface ApplicationContext {
    logger?: Logger;
    config?: Record<string, unknown>;
    /**
     * Unified messaging bus — always present.  Provides:
     *   events:     pub/sub DomainEvent delivery (publish/subscribe)
     *   commands:   void RPC (mutates state, awaits acknowledgement)
     *   queries:    data RPC (read-only, returns T)
     *   operations: data RPC (mutates state, returns T)
     */
    readonly bus: ISystemBus;
    /** Service container for typed dependency resolution across extensions. */
    services?: ServiceContainer;
}

/** Default context — in-memory bus, no logger.  Use in tests and bootstrapping. */
export const defaultCtx: ApplicationContext = Object.freeze({
    bus: new InMemorySystemBus(),
});
