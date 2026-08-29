import type { Logger } from "./ApplicationContext.js";
import { declareService, resolveService } from "./container/ioc.js";

/**
 * The platform logging API. Every log line in every package flows through here.
 *
 * A log line is an EVENT, not a sentence. It has three parts, and the signature
 * makes all three mandatory to think about:
 *
 *   const log = getLog("tern:tubemail:outgoing-email-sender");
 *   log.warn("send-failed", "Outgoing email send failed", { messageId });
 *          |               |                              |
 *          code            message                        fields
 *
 *   code     What happened, as a short stable slug. Unique WITHIN its logger,
 *            which is all it needs to be: the logger's URN already namespaces
 *            it, so the identity of a line is `name` + `code` and the same
 *            "send-failed" may appear under a dozen loggers. This is the field
 *            you filter and group on, and it never changes when the wording of
 *            the message does.
 *   message  What a human reads. Free prose, safe to reword at any time.
 *   fields   Everything else, structured. Values NEVER go in the message.
 *
 * The logger's name is a URN: a colon-delimited path from the product down to
 * the module, e.g. "tern:auth:login" or "sys:core:secrets". It is a namespace,
 * so a whole subtree is one query prefix.
 *
 * There are exactly two pieces:
 *
 *   SystemLogger  the container token for the ROOT sink. One per process, bound
 *                 once at boot. `ConsoleLogger` is the default so an unbooted
 *                 process (a test, a script, the browser) still logs.
 *   getLog()      how a module gets a logger. Returns a named view onto
 *                 whatever root is bound, resolved lazily.
 *
 * A package NEVER imports pino, never calls console, and never takes a logger
 * as a constructor option just to log. Swapping the backing implementation is a
 * single bind at boot, because the sink is a container service and nothing
 * holds a direct reference to it:
 *
 *   bindService(SystemLogger, new PinoLogger());     // @jasonscharf/server
 *   bindService(SystemLogger, captureForAssertions); // a test
 */

/**
 * Meta key carrying the logger's URN. RESERVED: a caller's own `name` in meta
 * is overwritten by the logger's name, so use a more specific key for domain
 * data.
 */
export const LOGGER_NAME_KEY = "name";

/**
 * Reads the fields bound to the current async scope by `runWithLogContext`, so
 * every line emitted while handling one request carries who it was for without
 * a single call site naming them.
 *
 * This is a slot rather than a direct import of logContext.js because THIS
 * module is in the browser bundle (see browser.ts) and the only way to carry
 * fields across an `await` is node:async_hooks, which a browser build cannot
 * resolve. The Node entry point re-exports logContext.js, whose import installs
 * the real reader; the browser entry point does not, so it keeps this no-op and
 * never pulls the built-in into the graph. One installer, one reader.
 */
let readAmbientFields: () => Record<string, unknown> | undefined = () => undefined;

/**
 * Installs the ambient-field reader. Called once, by logContext.js, when that
 * module is first imported. Application code binds fields with
 * `runWithLogContext` and never calls this.
 */
export function installLogContextReader(read: () => Record<string, unknown> | undefined): void {
    readAmbientFields = read;
}

/**
 * Container token for the root logger. This is the sink, and deliberately
 * nothing more than the four level methods: anything can be bound to it,
 * including a plain object literal that pushes to an array in a test. Naming
 * and metadata binding are {@link getLog}'s job, not the sink's, so an
 * implementation only has to know how to write a line.
 */
export abstract class SystemLogger implements Logger {
    abstract debug(code: string, msg: string, meta?: Record<string, unknown>): void;
    abstract info(code: string, msg: string, meta?: Record<string, unknown>): void;
    abstract warn(code: string, msg: string, meta?: Record<string, unknown>): void;
    abstract error(code: string, msg: string, meta?: Record<string, unknown>): void;
}

/**
 * Console-backed sink, the container default when no logger is bound.
 *
 * Renders as `[name/code] message`, which is the readable form for local dev
 * and the browser. Structured output for log aggregation is PinoLogger's job.
 */
export class ConsoleLogger implements Logger {
    debug(code: string, msg: string, meta?: Record<string, unknown>): void {
        // biome-ignore lint/suspicious/noConsole: this IS the console sink
        console.debug(...format(code, msg, meta));
    }

    info(code: string, msg: string, meta?: Record<string, unknown>): void {
        // biome-ignore lint/suspicious/noConsole: this IS the console sink
        console.info(...format(code, msg, meta));
    }

    warn(code: string, msg: string, meta?: Record<string, unknown>): void {
        // biome-ignore lint/suspicious/noConsole: this IS the console sink
        console.warn(...format(code, msg, meta));
    }

    error(code: string, msg: string, meta?: Record<string, unknown>): void {
        // biome-ignore lint/suspicious/noConsole: this IS the console sink
        console.error(...format(code, msg, meta));
    }
}

/** Split the reserved name out of meta and render `[name/code] message`. */
function format(code: string, msg: string, meta?: Record<string, unknown>): [string, ...unknown[]] {
    if (!meta) {
        return [`[${code}] ${msg}`];
    }

    const { [LOGGER_NAME_KEY]: name, ...rest } = meta;
    const label = typeof name === "string" ? `${name}/${code}` : code;
    const line = `[${label}] ${msg}`;

    if (Object.keys(rest).length === 0) {
        return [line];
    }

    return [line, rest];
}

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
 * because `getLog()` is called at MODULE scope: every module-level logger would
 * otherwise capture the ConsoleLogger default at import time, before boot has
 * bound the real one, and boot's bind would silently do nothing. Resolution is
 * a singleton lookup in the container, so this costs a map read per line.
 */
class BoundLogger implements NamedLogger {
    private readonly _meta: Record<string, unknown>;

    constructor(name: string, meta?: Record<string, unknown>) {
        this._meta = { ...meta, [LOGGER_NAME_KEY]: name };
    }

    debug(code: string, msg: string, meta?: Record<string, unknown>): void {
        this._sink().debug(code, msg, this._merge(meta));
    }

    info(code: string, msg: string, meta?: Record<string, unknown>): void {
        this._sink().info(code, msg, this._merge(meta));
    }

    warn(code: string, msg: string, meta?: Record<string, unknown>): void {
        this._sink().warn(code, msg, this._merge(meta));
    }

    error(code: string, msg: string, meta?: Record<string, unknown>): void {
        this._sink().error(code, msg, this._merge(meta));
    }

    child(meta: Record<string, unknown>): NamedLogger {
        const name = this._meta[LOGGER_NAME_KEY] as string;
        return new BoundLogger(name, { ...this._meta, ...meta });
    }

    private _sink(): Logger {
        return resolveService(SystemLogger);
    }

    /**
     * Precedence, lowest to highest: the ambient fields bound to this async
     * scope, then the logger's standing metadata, then this call's own. The
     * widest scope loses, so a handler that passes an explicit userIri overrides
     * whatever the request bound. The logger's name is applied last and always
     * wins, because it identifies where the line came from.
     */
    private _merge(meta?: Record<string, unknown>): Record<string, unknown> {
        const ambient = readAmbientFields();
        if (!ambient && !meta) {
            return this._meta;
        }

        return {
            ...ambient,
            ...this._meta,
            ...meta,
            [LOGGER_NAME_KEY]: this._meta[LOGGER_NAME_KEY],
        };
    }
}

/**
 * Get a logger for a module. THE entry point for logging anywhere.
 *
 * `urn` is a colon-delimited namespace path, product first, module last:
 * "tern:auth:login", "sys:core:secrets", "tern:tubemail:pg-writer". Because it
 * is a path, "name:tern:tubemail:*" selects one product's whole log surface.
 *
 * Safe to call at module scope: the returned logger holds no reference to the
 * root sink, so a logger created at import time still writes to whatever boot
 * later binds.
 */
export function getLog(urn: string, meta?: Record<string, unknown>): NamedLogger {
    return new BoundLogger(urn, meta);
}

declareService<Logger>(SystemLogger, () => new ConsoleLogger());
