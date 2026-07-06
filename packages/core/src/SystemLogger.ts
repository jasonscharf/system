import type { Logger } from "./ApplicationContext.js";
import { declareService } from "./container/ioc.js";

/**
 * Container token for the platform logger. Default binding: ConsoleLogger.
 * Boots rebind their structured logger (pino, etc.):
 *
 *   bindService(SystemLogger, pinoLogger);
 */
export abstract class SystemLogger implements Logger {
    abstract debug(msg: string, meta?: Record<string, unknown>): void;
    abstract info(msg: string, meta?: Record<string, unknown>): void;
    abstract warn(msg: string, meta?: Record<string, unknown>): void;
    abstract error(msg: string, meta?: Record<string, unknown>): void;
}

/** Console-backed Logger — the container default when no logger is bound. */
export class ConsoleLogger implements Logger {
    debug(msg: string, meta?: Record<string, unknown>): void {
        console.debug(msg, meta ?? "");
    }

    info(msg: string, meta?: Record<string, unknown>): void {
        console.info(msg, meta ?? "");
    }

    warn(msg: string, meta?: Record<string, unknown>): void {
        console.warn(msg, meta ?? "");
    }

    error(msg: string, meta?: Record<string, unknown>): void {
        console.error(msg, meta ?? "");
    }
}

declareService<Logger>(SystemLogger, () => new ConsoleLogger());
