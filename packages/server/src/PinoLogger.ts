/**
 * The production sink for {@link SystemLogger}: pino, shaped for Google Cloud
 * Logging.
 *
 * This is the ONLY module in the platform that imports pino. Everything else
 * goes through `getLog()` from @jasonscharf/core, so replacing pino is a
 * change to this file and the one `bindService` call at boot. It lives in
 * @jasonscharf/server rather than @jasonscharf/core because core is also loaded
 * in the browser, and pino has no business in a browser bundle.
 *
 * ── Why the output looks like this ────────────────────────────────────────────
 * Nodes run the Google Cloud Ops Agent, which reads container stdout and ships
 * it to Cloud Logging. It parses a JSON line into a structured entry, but only
 * recognizes ITS field names, not pino's defaults:
 *
 *   pino default        Cloud Logging wants     effect if left as pino's
 *   level: 30           severity: "INFO"        every line lands as INFO,
 *                                               so severity filters are useless
 *   msg: "..."          message: "..."          the summary line renders empty
 *   time: 1690000000    timestamp / time        ingest time used instead
 *
 * So the level formatter emits `severity` and `messageKey` is `message`. Every
 * other field rides along as jsonPayload, which is what makes `jsonPayload.name`
 * and `jsonPayload.correlationId` queryable in the Logs Explorer.
 *
 * `code` is written as a first-class field next to `name`, so the pair that
 * identifies a log line is two equality filters and never a substring match on
 * the message.
 */
import { bindService, LOGGER_NAME_KEY, type Logger, SystemLogger } from "@jasonscharf/core";
import { type Logger as PinoBaseLogger, pino } from "pino";
import { env } from "./env.js";

/** pino level label to the Cloud Logging LogSeverity enum. */
const SEVERITY: Record<string, string> = {
    trace: "DEBUG",
    debug: "DEBUG",
    info: "INFO",
    warn: "WARNING",
    error: "ERROR",
    fatal: "CRITICAL",
};

export interface PinoLoggerOptions {
    /**
     * Identity of the running process, e.g. "tern-server". Rides on every line
     * as `jsonPayload.service`, which is how one query separates the server's
     * lines from a worker's when both land in the same log bucket.
     */
    readonly service: string;
    /** Standing fields added to every line, e.g. the build sha and branch. */
    readonly base?: Record<string, unknown>;
    /** Overrides SYS_LOG_LEVEL. Present for tests, which pin a level. */
    readonly level?: string;
    /** Write target. Defaults to stdout, which is what the Ops Agent reads. */
    readonly destination?: NodeJS.WritableStream;
}

/**
 * pino-backed {@link SystemLogger}. Bind it at boot; do not hold a reference to
 * it, and never construct one in a library module.
 */
export class PinoLogger implements Logger {
    private readonly _pino: PinoBaseLogger;
    /**
     * pino `child()` pre-serializes its bindings, so a per-name child is
     * meaningfully cheaper than re-serializing `name` on every line. Names come
     * from `getLog()` calls, which are module-scoped and therefore a small,
     * bounded set.
     */
    private readonly _children = new Map<string, PinoBaseLogger>();

    constructor(options: PinoLoggerOptions) {
        this._pino = pino(
            {
                level: options.level ?? env.SYS_LOG_LEVEL,
                messageKey: "message",
                timestamp: pino.stdTimeFunctions.isoTime,
                base: { service: options.service, ...options.base },
                formatters: {
                    level: (label: string) => ({ severity: SEVERITY[label] ?? "DEFAULT" }),
                },
            },
            options.destination,
        );
    }

    debug(code: string, msg: string, meta?: Record<string, unknown>): void {
        this._write("debug", code, msg, meta);
    }

    info(code: string, msg: string, meta?: Record<string, unknown>): void {
        this._write("info", code, msg, meta);
    }

    warn(code: string, msg: string, meta?: Record<string, unknown>): void {
        this._write("warn", code, msg, meta);
    }

    error(code: string, msg: string, meta?: Record<string, unknown>): void {
        this._write("error", code, msg, meta);
    }

    /** Flush buffered lines. Call before a deliberate exit so nothing is lost. */
    flush(): void {
        this._pino.flush();
    }

    /**
     * The name is routed to a pre-serialized child rather than written as a
     * per-line field, so it is stripped from the meta that goes on the line.
     * Writing it both ways would serialize the same value twice per line.
     */
    private _write(
        level: "debug" | "info" | "warn" | "error",
        code: string,
        msg: string,
        meta?: Record<string, unknown>,
    ): void {
        if (!meta) {
            this._pino[level]({ code }, msg);
            return;
        }

        const { [LOGGER_NAME_KEY]: name, ...rest } = meta;
        const target = typeof name === "string" ? this._child(name) : this._pino;

        target[level]({ code, ...rest }, msg);
    }

    private _child(name: string): PinoBaseLogger {
        const existing = this._children.get(name);
        if (existing) {
            return existing;
        }

        const child = this._pino.child({ [LOGGER_NAME_KEY]: name });
        this._children.set(name, child);
        return child;
    }
}

/**
 * Bind pino as the process-wide sink. Call this FIRST in a boot sequence, before
 * anything that logs: lines written earlier go to the ConsoleLogger default and
 * land in Cloud Logging as unparsed text.
 */
export function bindPinoLogger(options: PinoLoggerOptions): PinoLogger {
    const logger = new PinoLogger(options);
    bindService(SystemLogger, logger);
    return logger;
}
