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
 *   - runWithLogContext binds ambient fields that ride on every line emitted in
 *     scope, across awaits, without a call site naming them.
 */

import { Writable } from "node:stream";
import {
    bindService,
    ConsoleLogger,
    getLog,
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

/**
 * Ambient log context (TRN-668).
 *
 * The point of this is that the code doing the logging never mentions the
 * fields: an edge binds the caller's identity once and everything downstream
 * inherits it. So every test here logs through a plain `getLog(...)` that knows
 * nothing about the context, and asserts on what came out the sink.
 */
describe("ambient log context", () => {
    afterEach(() => {
        bindService(SystemLogger, new ConsoleLogger());
    });

    it("test fields bound at the edge ride on a line logged deeper in", () => {
        const { sink, lines } = capture();
        bindService(SystemLogger, sink);

        runWithLogContext({ userIri: "urn:user:alice", sessionId: "sess-1" }, () => {
            getLog("sys:test:deep").info("did-a-thing", "Did a thing");
        });

        expect(lines[0].meta?.userIri).toBe("urn:user:alice");
        expect(lines[0].meta?.sessionId).toBe("sess-1");
    });

    it("test a line outside the scope carries no ambient fields", () => {
        const { sink, lines } = capture();
        bindService(SystemLogger, sink);

        runWithLogContext({ userIri: "urn:user:alice" }, () => {
            getLog("sys:test:inside").info("inside", "Inside");
        });
        getLog("sys:test:outside").info("outside", "Outside");

        expect(lines[1].meta?.userIri).toBeUndefined();
    });

    it("test the fields survive an await", async () => {
        const { sink, lines } = capture();
        bindService(SystemLogger, sink);

        // The reason this is AsyncLocalStorage and not a module variable: the
        // work a request does is almost entirely on the far side of an await.
        await runWithLogContext({ userIri: "urn:user:bob" }, async () => {
            await new Promise((resolve) => setTimeout(resolve, 1));
            getLog("sys:test:after-await").info("resumed", "Resumed");
        });

        expect(lines[0].meta?.userIri).toBe("urn:user:bob");
    });

    it("test concurrent scopes do not see each other's fields", async () => {
        const { sink, lines } = capture();
        bindService(SystemLogger, sink);

        // Two requests in flight at once is the normal case for a server, and a
        // context that leaked between them would attribute one user's lines to
        // another. Interleaved deliberately: the second starts before the first
        // has logged.
        await Promise.all([
            runWithLogContext({ userIri: "urn:user:alice" }, async () => {
                await new Promise((resolve) => setTimeout(resolve, 5));
                getLog("sys:test:req").info("alice", "Alice's line");
            }),
            runWithLogContext({ userIri: "urn:user:bob" }, async () => {
                getLog("sys:test:req").info("bob", "Bob's line");
            }),
        ]);

        const byCode = new Map(lines.map((l) => [l.code, l.meta?.userIri]));
        expect(byCode.get("alice")).toBe("urn:user:alice");
        expect(byCode.get("bob")).toBe("urn:user:bob");
    });

    it("test nesting merges, and the inner scope wins a collision", () => {
        const { sink, lines } = capture();
        bindService(SystemLogger, sink);

        // A WebSocket connection binding its own fields inside an authenticated
        // request must not drop the request's identity.
        runWithLogContext({ userIri: "urn:user:alice", tenant: "acme" }, () => {
            runWithLogContext({ userIri: "urn:user:carol", connectionId: "ws-9" }, () => {
                getLog("sys:test:nested").info("nested", "Nested");
            });
        });

        expect(lines[0].meta?.tenant).toBe("acme");
        expect(lines[0].meta?.connectionId).toBe("ws-9");
        expect(lines[0].meta?.userIri).toBe("urn:user:carol");
    });

    it("test an explicit field on the call beats the ambient one", () => {
        const { sink, lines } = capture();
        bindService(SystemLogger, sink);

        runWithLogContext({ userIri: "urn:user:alice" }, () => {
            getLog("sys:test:explicit").info("acted-on", "Acted on another user", {
                userIri: "urn:user:target",
            });
        });

        expect(lines[0].meta?.userIri).toBe("urn:user:target");
    });

    it("test the logger name still wins over an ambient field of the same key", () => {
        const { sink, lines } = capture();
        bindService(SystemLogger, sink);

        // `name` is reserved for the logger URN, and ambient fields are the
        // widest scope of all, so they must not be able to forge it.
        runWithLogContext({ name: "not-the-logger" }, () => {
            getLog("sys:test:reserved").info("named", "Named");
        });

        expect(lines[0].meta?.name).toBe("sys:test:reserved");
    });

    it("test the callback's return value is passed through", () => {
        expect(runWithLogContext({ userIri: "urn:user:alice" }, () => 42)).toBe(42);
    });
});
