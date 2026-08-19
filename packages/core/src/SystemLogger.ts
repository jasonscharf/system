import type { Logger } from "./ApplicationContext.js";
import { declareService, resolveService } from "./container/ioc.js";

/**
 * The platform logging API. Every log line in every package flows through here.
 *
 * There are exactly two pieces:
 *
 *   SystemLogger  the container token for the ROOT sink. One per process, bound
 *                 once at boot. `ConsoleLogger` is the default so an unbooted
 *                 process (a test, a script, the browser) still logs.
 *   getLogger()   how a module gets a logger. Returns a named view onto
 *                 whatever root is bound, resolved lazily.
 *
 * A package NEVER imports pino, never calls console, and never takes a logger
 * as a constructor option just to log:
 *
 *   const log = getLogger("PulsarConsumer");
 *   log.info("subscribed", { topic });
 *
 * Swapping the backing implementation is a single bind at boot, because the
 * sink is a container service and nothing holds a direct reference to it:
 *
 *   bindService(SystemLogger, new PinoLogger());     // @jasonscharf/server
 *   bindService(SystemLogger, captureForAssertions); // a test
 */

/**
 * Meta key carrying the logger name. RESERVED: a caller's own `name` in meta is
 * overwritten by the logger's name, so use a more specific key for domain data.
 */
export const LOGGER_NAME_KEY = "name";

/**
 * Container token for the root logger. This is the sink, and deliberately
 * nothing more than the four level methods: anything can be bound to it,
 * including a plain object literal that pushes to an array in a test. Naming
 * and metadata binding are {@link getLogger}'s job, not the sink's, so an
 * implementation only has to know how to write a line.
 */
export abstract class SystemLogger implements Logger {
    abstract debug(msg: string, meta?: Record<string, unknown>): void;
    abstract info(msg: string, meta?: Record<string, unknown>): void;
    abstract warn(msg: string, meta?: Record<string, unknown>): void;
    abstract error(msg: string, meta?: Record<string, unknown>): void;
}

/**
 * Console-backed sink, the container default when no logger is bound.
 *
 * Renders the logger name as a `[name]` prefix, which is what the platform's
 * log lines looked like before they were unified and is the readable form for
 * local dev. Structured output for log aggregation is PinoLogger's job.
 */
export class ConsoleLogger implements Logger {
    debug(msg: string, meta?: Record<string, unknown>): void {
        // biome-ignore lint/suspicious/noConsole: this IS the console sink
        console.debug(...format(msg, meta));
    }

    info(msg: string, meta?: Record<string, unknown>): void {
        // biome-ignore lint/suspicious/noConsole: this IS the console sink
        console.info(...format(msg, meta));
    }

    warn(msg: string, meta?: Record<string, unknown>): void {
        // biome-ignore lint/suspicious/noConsole: this IS the console sink
        console.warn(...format(msg, meta));
    }

    error(msg: string, meta?: Record<string, unknown>): void {
        // biome-ignore lint/suspicious/noConsole: this IS the console sink
        console.error(...format(msg, meta));
    }
}

/** Split the reserved name out of meta and render it as a readable prefix. */
function format(msg: string, meta?: Record<string, unknown>): [string, ...unknown[]] {
    if (!meta) {
        return [msg];
    }

    const { [LOGGER_NAME_KEY]: name, ...rest } = meta;
    const line = typeof name === "string" ? `[${name}] ${msg}` : msg;

    if (Object.keys(rest).length === 0) {
        return [line];
    }

    return [line, rest];
}

declareService<Logger>(SystemLogger, () => new ConsoleLogger());

/**
 * A logger bound to a name and, optionally, standing metadata. `child()` adds
 * more standing metadata without renaming, which is how per-request context
 * (a correlation id, a tenant) rides along on every line a request produces.
 */
export interface NamedLogger extends Logger {
    child(meta: Record<string, unknown>): NamedLogger;
}

/**
 * A named view onto the bound root sink.
 *
 * The root is resolved on each call rather than captured at construction,
 * because `getLogger()` is called at MODULE scope: every module-level logger
 * would otherwise capture the ConsoleLogger default at import time, before boot
 * has bound the real one, and boot's bind would silently do nothing. Resolution
 * is a singleton lookup in the container, so this costs a map read per line.
 */
class BoundLogger implements NamedLogger {
    private readonly _meta: Record<string, unknown>;

    constructor(name: string, meta?: Record<string, unknown>) {
        this._meta = { ...meta, [LOGGER_NAME_KEY]: name };
    }

    debug(msg: string, meta?: Record<string, unknown>): void {
        this._sink().debug(msg, this._merge(meta));
    }

    info(msg: string, meta?: Record<string, unknown>): void {
        this._sink().info(msg, this._merge(meta));
    }

    warn(msg: string, meta?: Record<string, unknown>): void {
        this._sink().warn(msg, this._merge(meta));
    }

    error(msg: string, meta?: Record<string, unknown>): void {
        this._sink().error(msg, this._merge(meta));
    }

    child(meta: Record<string, unknown>): NamedLogger {
        const name = this._meta[LOGGER_NAME_KEY] as string;
        return new BoundLogger(name, { ...this._meta, ...meta });
    }

    private _sink(): Logger {
        return resolveService(SystemLogger);
    }

    /** Standing metadata first, so a per-call key of the same name wins. */
    private _merge(meta?: Record<string, unknown>): Record<string, unknown> {
        if (!meta) {
            return this._meta;
        }

        return { ...this._meta, ...meta, [LOGGER_NAME_KEY]: this._meta[LOGGER_NAME_KEY] };
    }
}

/**
 * Get a named logger. THE entry point for logging anywhere in the platform.
 *
 * Safe to call at module scope: the returned logger holds no reference to the
 * root sink, so a logger created at import time still writes to whatever boot
 * later binds.
 */
export function getLogger(name: string, meta?: Record<string, unknown>): NamedLogger {
    return new BoundLogger(name, meta);
}
