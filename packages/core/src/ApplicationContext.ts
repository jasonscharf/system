import type { ISystemBus } from "./bus/ISystemBus.js";
import { SystemBus } from "./bus/SystemBus.js";
import { resolveService } from "./container/ioc.js";
import { SystemLogger } from "./SystemLogger.js";

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
}

/**
 * Default context — members resolve lazily from the IoC container, so a
 * context read (or a spread like `{...defaultCtx}` at context build time)
 * always reflects the bindings in force at that moment.  Rebinding SystemBus
 * or SystemLogger at boot changes what every subsequently created context
 * carries.
 */
export const defaultCtx: ApplicationContext = Object.freeze({
    get bus(): ISystemBus {
        return resolveService(SystemBus);
    },
    get logger(): Logger {
        return resolveService(SystemLogger);
    },
});
