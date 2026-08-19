/**
 * The platform logging API: one entry point, one swappable sink.
 *
 * Covers:
 *   - getLogger() writes to whatever is bound to SystemLogger.
 *   - Late binding: a logger built at MODULE scope, before boot, still reaches
 *     the sink boot binds afterwards. This is the property that makes
 *     `const log = getLogger(...)` at the top of a file safe.
 *   - The logger name and child metadata ride along as structured fields.
 *   - ConsoleLogger renders the name as a readable prefix.
 *   - PinoLogger emits the shape Google Cloud Logging parses: `severity`,
 *     `message`, and the name as a queryable field rather than a prefix.
 */

import { Writable } from "node:stream";
import {
    bindService,
    ConsoleLogger,
    getLogger,
    type Logger,
    SystemLogger,
} from "@jasonscharf/core";
import { PinoLogger } from "@jasonscharf/server";
import { afterEach, describe, expect, it } from "vitest";

interface Line {
    level: string;
    msg: string;
    meta?: Record<string, unknown>;
}

/** A sink that records instead of writing, bound in place of the real one. */
function capture(): { sink: Logger; lines: Line[] } {
    const lines: Line[] = [];
    const sink: Logger = {
        debug: (msg, meta) => lines.push({ level: "debug", msg, meta }),
        info: (msg, meta) => lines.push({ level: "info", msg, meta }),
        warn: (msg, meta) => lines.push({ level: "warn", msg, meta }),
        error: (msg, meta) => lines.push({ level: "error", msg, meta }),
    };
    return { sink, lines };
}

/**
 * Built at module scope, BEFORE any test binds a sink, exactly as a real
 * module's `const log = getLogger("X")` is. If getLogger captured the sink at
 * construction this logger would be pinned to the ConsoleLogger default and
 * every assertion below would see nothing.
 */
const moduleScopedLog = getLogger("ModuleScoped");

describe("platform logging", () => {
    afterEach(() => {
        bindService(SystemLogger, new ConsoleLogger());
    });

    it("test getLogger writes to the bound sink", () => {
        const { sink, lines } = capture();
        bindService(SystemLogger, sink);

        getLogger("Widget").info("hello");

        expect(lines).toHaveLength(1);
        expect(lines[0].level).toBe("info");
        expect(lines[0].msg).toBe("hello");
    });

    it("test a module-scoped logger reaches a sink bound after it was created", () => {
        const { sink, lines } = capture();
        bindService(SystemLogger, sink);

        moduleScopedLog.warn("late");

        expect(lines).toEqual([{ level: "warn", msg: "late", meta: { name: "ModuleScoped" } }]);
    });

    it("test the logger name rides along as a field", () => {
        const { sink, lines } = capture();
        bindService(SystemLogger, sink);

        getLogger("PulsarConsumer").error("subscribe failed", { topic: "t1" });

        expect(lines[0].meta).toEqual({ name: "PulsarConsumer", topic: "t1" });
    });

    it("test child metadata is merged into every line", () => {
        const { sink, lines } = capture();
        bindService(SystemLogger, sink);

        const log = getLogger("dispatch").child({ correlationId: "abc" });
        log.info("received", { name: "core.user.create" });

        // The correlation id rides along, and the logger's own name is not
        // clobbered by a caller passing a `name` of their own.
        expect(lines[0].meta).toEqual({
            name: "dispatch",
            correlationId: "abc",
        });
    });

    it("test every level reaches the sink", () => {
        const { sink, lines } = capture();
        bindService(SystemLogger, sink);

        const log = getLogger("Levels");
        log.debug("d");
        log.info("i");
        log.warn("w");
        log.error("e");

        expect(lines.map((l) => l.level)).toEqual(["debug", "info", "warn", "error"]);
    });

    it("test ConsoleLogger renders the name as a prefix", () => {
        const seen: unknown[][] = [];
        // biome-ignore lint/suspicious/noConsole: this test asserts on the console sink
        const original = console.info;
        console.info = (...args: unknown[]) => {
            seen.push(args);
        };

        try {
            bindService(SystemLogger, new ConsoleLogger());
            getLogger("Widget").info("hello", { id: 7 });
        } finally {
            console.info = original;
        }

        expect(seen).toEqual([["[Widget] hello", { id: 7 }]]);
    });
});

describe("PinoLogger", () => {
    afterEach(() => {
        bindService(SystemLogger, new ConsoleLogger());
    });

    /** Bind a PinoLogger writing to a buffer and return the parsed lines. */
    function pinoLines(
        write: (log: PinoLogger) => void,
        level = "debug",
    ): Record<string, unknown>[] {
        const chunks: string[] = [];
        const destination = new Writable({
            write(chunk, _enc, cb) {
                chunks.push(String(chunk));
                cb();
            },
        });

        const logger = new PinoLogger({ service: "test-service", level, destination });
        write(logger);

        return chunks
            .join("")
            .split("\n")
            .filter((l) => l.length > 0)
            .map((l) => JSON.parse(l) as Record<string, unknown>);
    }

    it("test output uses the field names Cloud Logging parses", () => {
        const [line] = pinoLines((log) => log.info("started", { port: 8080 }));

        // `severity` and `message`, NOT pino's `level: 30` and `msg`: the Ops
        // Agent keys off these names and drops everything else to jsonPayload.
        expect(line.severity).toBe("INFO");
        expect(line.message).toBe("started");
        expect(line.port).toBe(8080);
        expect(line.service).toBe("test-service");
        expect(line.level).toBeUndefined();
        expect(line.msg).toBeUndefined();
    });

    it("test each level maps to its Cloud Logging severity", () => {
        const lines = pinoLines((log) => {
            log.debug("d");
            log.info("i");
            log.warn("w");
            log.error("e");
        });

        expect(lines.map((l) => l.severity)).toEqual(["DEBUG", "INFO", "WARNING", "ERROR"]);
    });

    it("test the logger name is a queryable field, not a message prefix", () => {
        const [line] = pinoLines((log) => getLoggerVia(log, "RedisSub").info("subscribed"));

        expect(line.name).toBe("RedisSub");
        expect(line.message).toBe("subscribed");
    });

    it("test the level threshold suppresses lines below it", () => {
        const lines = pinoLines((log) => {
            log.debug("dropped");
            log.warn("kept");
        }, "warn");

        expect(lines.map((l) => l.message)).toEqual(["kept"]);
    });

    it("test standing base fields ride on every line", () => {
        const chunks: string[] = [];
        const destination = new Writable({
            write(chunk, _enc, cb) {
                chunks.push(String(chunk));
                cb();
            },
        });
        const logger = new PinoLogger({
            service: "tern-server",
            base: { build: "abc123", branch: "main" },
            destination,
        });
        logger.info("boot");

        const line = JSON.parse(chunks.join("").trim()) as Record<string, unknown>;
        expect(line.build).toBe("abc123");
        expect(line.branch).toBe("main");
    });
});

/** Route a getLogger() call through a specific PinoLogger instance. */
function getLoggerVia(sink: Logger, name: string): Logger {
    bindService(SystemLogger, sink);
    return getLogger(name);
}
