/**
 * The platform logging API: one entry point, one swappable sink.
 *
 * A line is `log.level(code, message, fields)`. The code is what you filter on
 * and the message is prose you can reword freely, so the tests below assert on
 * the code and the fields, never on wording.
 *
 * Covers:
 *   - getLog() writes to whatever is bound to SystemLogger.
 *   - Late binding: a logger built at MODULE scope, before boot, still reaches
 *     the sink boot binds afterwards. This is the property that makes
 *     `const log = getLog(...)` at the top of a file safe.
 *   - The logger URN and child metadata ride along as structured fields.
 *   - ConsoleLogger renders name and code as a readable prefix.
 *   - PinoLogger emits the shape Google Cloud Logging parses: `severity`,
 *     `message`, and name + code as queryable fields rather than prose.
 */

import { Writable } from "node:stream";
import {
    bindService,
    ConsoleLogger,
    getLog,
    getLogContext,
    type Logger,
    runWithLogContext,
    SystemLogger,
} from "@jasonscharf/core";
import { PinoLogger } from "@jasonscharf/server";
import { afterEach, describe, expect, it } from "vitest";

interface Line {
    level: string;
    code: string;
    msg: string;
    meta?: Record<string, unknown>;
}

/** A sink that records instead of writing, bound in place of the real one. */
function capture(): { sink: Logger; lines: Line[] } {
    const lines: Line[] = [];
    const sink: Logger = {
        debug: (code, msg, meta) => lines.push({ level: "debug", code, msg, meta }),
        info: (code, msg, meta) => lines.push({ level: "info", code, msg, meta }),
        warn: (code, msg, meta) => lines.push({ level: "warn", code, msg, meta }),
        error: (code, msg, meta) => lines.push({ level: "error", code, msg, meta }),
    };
    return { sink, lines };
}

/**
 * Built at module scope, BEFORE any test binds a sink, exactly as a real
 * module's `const log = getLog("X")` is. If getLog captured the sink at
 * construction this logger would be pinned to the ConsoleLogger default and
 * every assertion below would see nothing.
 */
const moduleScopedLog = getLog("sys:test:module-scoped");

describe("platform logging", () => {
    afterEach(() => {
        bindService(SystemLogger, new ConsoleLogger());
    });

    it("test getLog writes to the bound sink", () => {
        const { sink, lines } = capture();
        bindService(SystemLogger, sink);

        getLog("sys:test:widget").info("hello", "Hello there");

        expect(lines).toHaveLength(1);
        expect(lines[0].level).toBe("info");
        expect(lines[0].code).toBe("hello");
        expect(lines[0].msg).toBe("Hello there");
    });

    it("test a module-scoped logger reaches a sink bound after it was created", () => {
        const { sink, lines } = capture();
        bindService(SystemLogger, sink);

        moduleScopedLog.warn("late", "Bound after the logger was built");

        expect(lines).toEqual([
            {
                level: "warn",
                code: "late",
                msg: "Bound after the logger was built",
                meta: { name: "sys:test:module-scoped" },
            },
        ]);
    });

    it("test the logger URN rides along as a field", () => {
        const { sink, lines } = capture();
        bindService(SystemLogger, sink);

        getLog("sys:flow:pulsar-consumer").error("subscribe-failed", "Subscribe failed", {
            topic: "t1",
        });

        expect(lines[0].code).toBe("subscribe-failed");
        expect(lines[0].meta).toEqual({ name: "sys:flow:pulsar-consumer", topic: "t1" });
    });

    it("test child metadata is merged into every line", () => {
        const { sink, lines } = capture();
        bindService(SystemLogger, sink);

        const log = getLog("sys:app:dispatch").child({ correlationId: "abc" });
        log.info("received", "Request received", { name: "core.user.create" });

        // The correlation id rides along, and the logger's own name is not
        // clobbered by a caller passing a `name` of their own.
        expect(lines[0].meta).toEqual({
            name: "sys:app:dispatch",
            correlationId: "abc",
        });
    });

    it("test every level reaches the sink", () => {
        const { sink, lines } = capture();
        bindService(SystemLogger, sink);

        const log = getLog("sys:test:levels");
        log.debug("d", "debug");
        log.info("i", "info");
        log.warn("w", "warn");
        log.error("e", "error");

        expect(lines.map((l) => l.level)).toEqual(["debug", "info", "warn", "error"]);
    });

    it("test ConsoleLogger renders name and code as a prefix", () => {
        const seen: unknown[][] = [];
        // biome-ignore lint/suspicious/noConsole: this test asserts on the console sink
        const original = console.info;
        console.info = (...args: unknown[]) => {
            seen.push(args);
        };

        try {
            bindService(SystemLogger, new ConsoleLogger());
            getLog("sys:test:widget").info("hello", "Hello there", { id: 7 });
        } finally {
            console.info = original;
        }

        expect(seen).toEqual([["[sys:test:widget/hello] Hello there", { id: 7 }]]);
    });
});

describe("ambient log context", () => {
    afterEach(() => {
        bindService(SystemLogger, new ConsoleLogger());
    });

    it("test ambient fields ride on every line inside the context", () => {
        const { sink, lines } = capture();
        bindService(SystemLogger, sink);

        runWithLogContext({ userIri: "urn:u:1", sessionId: "s-1" }, () => {
            getLog("sys:test:handler").info("handled", "Handled");
        });

        expect(lines[0].meta).toEqual({
            name: "sys:test:handler",
            userIri: "urn:u:1",
            sessionId: "s-1",
        });
    });

    it("test lines outside any context carry no ambient fields", () => {
        const { sink, lines } = capture();
        bindService(SystemLogger, sink);

        getLog("sys:test:boot").info("booted", "Booted");

        expect(lines[0].meta).toEqual({ name: "sys:test:boot" });
        expect(getLogContext()).toBeNull();
    });

    it("test explicit per-call and child fields beat ambient ones", () => {
        const { sink, lines } = capture();
        bindService(SystemLogger, sink);

        runWithLogContext({ userIri: "ambient", tenant: "ambient-tenant" }, () => {
            const log = getLog("sys:test:precedence").child({ tenant: "child-tenant" });
            log.info("checked", "Checked", { userIri: "explicit" });
        });

        expect(lines[0].meta).toEqual({
            name: "sys:test:precedence",
            userIri: "explicit",
            tenant: "child-tenant",
        });
    });

    it("test contexts nest and the outer context is restored on exit", () => {
        const { sink, lines } = capture();
        bindService(SystemLogger, sink);
        const log = getLog("sys:test:nesting");

        runWithLogContext({ userIri: "outer" }, () => {
            runWithLogContext({ sessionId: "inner" }, () => {
                log.info("inner", "Inner");
            });
            log.info("outer", "Outer");
        });

        expect(lines[0].meta).toEqual({
            name: "sys:test:nesting",
            userIri: "outer",
            sessionId: "inner",
        });
        expect(lines[1].meta).toEqual({ name: "sys:test:nesting", userIri: "outer" });
    });

    it("test the context follows async execution across awaits", async () => {
        const { sink, lines } = capture();
        bindService(SystemLogger, sink);
        const log = getLog("sys:test:async");

        // Two interleaved requests: each line must carry ITS request's fields.
        await Promise.all([
            runWithLogContext({ userIri: "urn:u:a" }, async () => {
                await Promise.resolve();
                log.info("a", "A");
            }),
            runWithLogContext({ userIri: "urn:u:b" }, async () => {
                await Promise.resolve();
                log.info("b", "B");
            }),
        ]);

        const byCode = new Map(lines.map((l) => [l.code, l.meta]));
        expect(byCode.get("a")).toEqual({ name: "sys:test:async", userIri: "urn:u:a" });
        expect(byCode.get("b")).toEqual({ name: "sys:test:async", userIri: "urn:u:b" });
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
        const [line] = pinoLines((log) => log.info("started", "Service started", { port: 8080 }));

        // `severity` and `message`, NOT pino's `level: 30` and `msg`: the Ops
        // Agent keys off these names and drops everything else to jsonPayload.
        expect(line.severity).toBe("INFO");
        expect(line.message).toBe("Service started");
        expect(line.code).toBe("started");
        expect(line.port).toBe(8080);
        expect(line.service).toBe("test-service");
        expect(line.level).toBeUndefined();
        expect(line.msg).toBeUndefined();
    });

    it("test each level maps to its Cloud Logging severity", () => {
        const lines = pinoLines((log) => {
            log.debug("d", "debug");
            log.info("i", "info");
            log.warn("w", "warn");
            log.error("e", "error");
        });

        expect(lines.map((l) => l.severity)).toEqual(["DEBUG", "INFO", "WARNING", "ERROR"]);
    });

    it("test name and code are queryable fields, not a message prefix", () => {
        const [line] = pinoLines((log) => {
            bindService(SystemLogger, log);
            getLog("sys:flow:redis-sub").info("subscribed", "Subscribed to channels");
        });

        expect(line.name).toBe("sys:flow:redis-sub");
        expect(line.code).toBe("subscribed");
        expect(line.message).toBe("Subscribed to channels");
    });

    it("test the level threshold suppresses lines below it", () => {
        const lines = pinoLines((log) => {
            log.debug("dropped", "below the threshold");
            log.warn("kept", "at the threshold");
        }, "warn");

        expect(lines.map((l) => l.code)).toEqual(["kept"]);
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
        logger.info("boot", "Booted");

        const line = JSON.parse(chunks.join("").trim()) as Record<string, unknown>;
        expect(line.build).toBe("abc123");
        expect(line.branch).toBe("main");
    });
});
