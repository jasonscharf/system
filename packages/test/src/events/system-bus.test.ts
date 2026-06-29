/**
 * ISystemBus integration tests — command, query, operation, and event roundtrips.
 *
 * InMemorySystemBus:  always runs.
 * RedisSystemBus:     runs when SYS_REDIS_URL is set.
 *
 * Each Redis test suite uses a unique prefix so runs never see stale state.
 */

import {
    type DomainEvent,
    InMemorySystemBus,
    type ISystemBus,
    makeUri,
    NS_TEST,
} from "@jasonscharf/core";
import { RedisSystemBus } from "@jasonscharf/events";
import { Redis } from "ioredis";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ── Helpers ───────────────────────────────────────────────────────────────────

function uniqueId(): string {
    return Math.random().toString(36).slice(2, 10);
}

function delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(condition: () => boolean, timeoutMs = 4000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
        if (Date.now() > deadline) {
            throw new Error(`waitFor timed out after ${timeoutMs}ms`);
        }
        await delay(20);
    }
}

async function cleanupRedisKeys(url: string, prefix: string): Promise<void> {
    const r = new Redis(url);
    const keys = await r.keys(`${prefix}*`);
    if (keys.length > 0) {
        await r.del(...keys);
    }
    await r.quit();
}

// ── Fixture IRIs ──────────────────────────────────────────────────────────────

const CREATE_WIDGET = "http://example.com/commands/CreateWidget";
const GET_WIDGET = "http://example.com/queries/GetWidget";
const PROCESS_ORDER = "http://example.com/operations/ProcessOrder";
const WIDGET_CREATED = "http://example.com/events/WidgetCreated";

interface WidgetPayload {
    widgetId: string;
    name: string;
}

// ── Shared ISystemBus contract suite ─────────────────────────────────────────

function systemBusSuite(name: string, factory: () => ISystemBus) {
    describe(name, () => {
        let bus: ISystemBus;

        beforeEach(() => {
            bus = factory();
        });
        afterEach(async () => {
            await bus.close();
        });

        // ── Events ────────────────────────────────────────────────────────────

        describe("events", () => {
            it("test publish delivers to pub sub subscribers", async () => {
                const received: DomainEvent<unknown>[] = [];
                await bus.subscribe(WIDGET_CREATED, `sub-${uniqueId()}`, async (e) => {
                    received.push(e);
                });

                await bus.publish({
                    id: "evt-1",
                    type: WIDGET_CREATED,
                    source: "http://example.com",
                    timestamp: Date.now(),
                    payload: { widgetId: "w1", name: "Sprocket" },
                });

                await waitFor(() => received.length === 1);
                expect(received[0]?.id).toBe("evt-1");
                expect((received[0]?.payload as WidgetPayload).name).toBe("Sprocket");
            });

            it("test publish does not throw with no subscribers", async () => {
                await expect(
                    bus.publish({
                        id: "evt-orphan",
                        type: WIDGET_CREATED,
                        source: "http://example.com",
                        timestamp: Date.now(),
                        payload: {},
                    }),
                ).resolves.not.toThrow();
            });

            it("test subscriber error does not abort other subscribers", async () => {
                const goodIds: string[] = [];
                const suffix = uniqueId();

                await bus.subscribe(WIDGET_CREATED, `bad-${suffix}`, async () => {
                    throw new Error("subscriber failure");
                });
                await bus.subscribe(WIDGET_CREATED, `good-${suffix}`, async (e) => {
                    goodIds.push((e.payload as WidgetPayload).widgetId);
                });

                await bus.publish({
                    id: "evt-2",
                    type: WIDGET_CREATED,
                    source: "http://example.com",
                    timestamp: Date.now(),
                    payload: { widgetId: "w2", name: "Cog" },
                });

                await waitFor(() => goodIds.length === 1);
                expect(goodIds).toEqual(["w2"]);
            });
        });

        // ── Commands ──────────────────────────────────────────────────────────

        describe("commands", () => {
            it("test command roundtrip returns void", async () => {
                let processed: unknown;

                await bus.handle(CREATE_WIDGET, "command", async (payload) => {
                    processed = payload;
                    return undefined;
                });

                await bus.command(CREATE_WIDGET, { widgetId: "w3", name: "Bolt" });

                expect(processed).toEqual({ widgetId: "w3", name: "Bolt" });
            });

            it("test command with no handler rejects", async () => {
                await expect(
                    bus.command("http://example.com/commands/Unknown", { x: 1 }),
                ).rejects.toThrow();
            });

            it("test command handler error propagates", async () => {
                await bus.handle(CREATE_WIDGET, "command", async () => {
                    throw new Error("handler exploded");
                });

                await expect(bus.command(CREATE_WIDGET, {})).rejects.toThrow("handler exploded");
            });

            it("test command payload is optional", async () => {
                let called = false;
                await bus.handle(CREATE_WIDGET, "command", async () => {
                    called = true;
                });

                await bus.command(CREATE_WIDGET);
                expect(called).toBe(true);
            });
        });

        // ── Queries ───────────────────────────────────────────────────────────

        describe("queries", () => {
            it("test query roundtrip returns result", async () => {
                await bus.handle(GET_WIDGET, "query", async (payload) => {
                    const { widgetId } = payload as { widgetId: string };
                    return { widgetId, name: "Hydrated Widget", createdAt: "2024-01-01" };
                });

                const result = await bus.query<{ widgetId: string; name: string }>(GET_WIDGET, {
                    widgetId: "w4",
                });

                expect(result.widgetId).toBe("w4");
                expect(result.name).toBe("Hydrated Widget");
            });

            it("test query with no handler rejects", async () => {
                await expect(bus.query("http://example.com/queries/Unknown")).rejects.toThrow();
            });

            it("test query handler error propagates", async () => {
                await bus.handle(GET_WIDGET, "query", async () => {
                    throw new Error("DB not found");
                });

                await expect(bus.query(GET_WIDGET, { widgetId: "missing" })).rejects.toThrow(
                    "DB not found",
                );
            });

            it("test query returns null when handler returns null", async () => {
                await bus.handle(GET_WIDGET, "query", async () => null);

                const result = await bus.query(GET_WIDGET, { widgetId: "none" });
                expect(result).toBeNull();
            });

            it("test query returns complex structure", async () => {
                const widget = { id: "w5", tags: ["a", "b"], meta: { version: 2 } };
                await bus.handle(GET_WIDGET, "query", async () => widget);

                const result = await bus.query(GET_WIDGET);
                expect(result).toEqual(widget);
            });
        });

        // ── Operations ────────────────────────────────────────────────────────

        describe("operations", () => {
            it("test operation roundtrip returns mutated result", async () => {
                await bus.handle(PROCESS_ORDER, "operation", async (payload) => {
                    const { orderId } = payload as { orderId: string };
                    return { orderId, status: "processed", processedAt: "2024-01-01" };
                });

                const result = await bus.operation<{ orderId: string; status: string }>(
                    PROCESS_ORDER,
                    { orderId: "ord-99" },
                );

                expect(result.orderId).toBe("ord-99");
                expect(result.status).toBe("processed");
            });

            it("test operation with no handler rejects", async () => {
                await expect(
                    bus.operation("http://example.com/operations/Unknown"),
                ).rejects.toThrow();
            });

            it("test operation handler error propagates", async () => {
                await bus.handle(PROCESS_ORDER, "operation", async () => {
                    throw new Error("payment failed");
                });

                await expect(bus.operation(PROCESS_ORDER, { orderId: "x" })).rejects.toThrow(
                    "payment failed",
                );
            });

            it("test operation is distinct from query", async () => {
                await bus.handle(PROCESS_ORDER, "operation", async () => "from-operation");
                await bus.handle(PROCESS_ORDER, "query", async () => "from-query");

                const opResult = await bus.operation(PROCESS_ORDER);
                const qResult = await bus.query(PROCESS_ORDER);

                expect(opResult).toBe("from-operation");
                expect(qResult).toBe("from-query");
            });
        });

        // ── Cross-facility isolation ───────────────────────────────────────────

        describe("cross-facility isolation", () => {
            it("test command handler does not answer query for same type iri", async () => {
                await bus.handle(CREATE_WIDGET, "command", async () => undefined);
                await expect(bus.query(CREATE_WIDGET)).rejects.toThrow();
            });

            it("test query handler does not answer command for same type iri", async () => {
                await bus.handle(GET_WIDGET, "query", async () => ({ name: "x" }));
                await expect(bus.command(GET_WIDGET)).rejects.toThrow();
            });
        });
    });
}

// ── InMemorySystemBus ─────────────────────────────────────────────────────────

systemBusSuite("InMemorySystemBus", () => new InMemorySystemBus());

// ── RedisSystemBus ────────────────────────────────────────────────────────────

if (process.env.SYS_REDIS_URL) {
    const redisUrl = process.env.SYS_REDIS_URL as string;

    // The bus is handed a Redis connection it does not own, so each connection
    // created for a bus under test is tracked and quit after every test.
    const trackedRedis: Redis[] = [];
    afterEach(async () => {
        for (const r of trackedRedis.splice(0)) {
            await r.quit().catch(() => {});
        }
    });

    function makeRedisBus(prefix: string): RedisSystemBus {
        const redis = new Redis(redisUrl);
        trackedRedis.push(redis);
        // 500 ms keeps "no handler" timeout tests well under vitest's 5 s
        // default while still being long enough for normal round-trips.
        return new RedisSystemBus(redis, { keyPrefix: prefix, requestTimeoutMs: 500 });
    }

    // Run the full contract suite against Redis.
    systemBusSuite("RedisSystemBus (contract)", () => {
        const prefix = `${makeUri(NS_TEST, uniqueId())}:`;
        return makeRedisBus(prefix);
    });

    // ── Redis-specific: concurrent callers ────────────────────────────────────

    describe("RedisSystemBus — concurrent RPC callers", () => {
        let prefix: string;
        let buses: RedisSystemBus[];

        beforeEach(() => {
            prefix = `${makeUri(NS_TEST, uniqueId())}:`;
            buses = [];
        });

        afterEach(async () => {
            for (const b of buses) {
                await b.close();
            }
            await cleanupRedisKeys(redisUrl, prefix);
        });

        function make(): RedisSystemBus {
            const b = makeRedisBus(prefix);
            buses.push(b);
            return b;
        }

        it("test multiple concurrent queries all resolve", async () => {
            const server = make();
            await server.handle(GET_WIDGET, "query", async (p) => {
                const { widgetId } = p as { widgetId: string };
                return { widgetId, name: `Widget ${widgetId}` };
            });

            const client = make();
            const promises = Array.from({ length: 5 }, (_, i) =>
                client.query<{ widgetId: string; name: string }>(GET_WIDGET, { widgetId: `w${i}` }),
            );

            const results = await Promise.all(promises);
            expect(results).toHaveLength(5);
            for (let i = 0; i < 5; i++) {
                expect(results[i]?.widgetId).toBe(`w${i}`);
            }
        });

        it("test handler on one instance answers caller on another", async () => {
            const handlerBus = make();
            await handlerBus.handle(CREATE_WIDGET, "command", async (payload) => {
                const w = payload as WidgetPayload;
                expect(w.widgetId).toBe("cross-process");
            });

            const callerBus = make();
            await callerBus.command(CREATE_WIDGET, { widgetId: "cross-process", name: "X" });
        });

        it("test query timeout rejects when no handler registered", async () => {
            const callerBus = make();

            await expect(callerBus.query("http://example.com/queries/Unhandled")).rejects.toThrow(
                /timed out/i,
            );
        }, 5_000);

        it("test competing command handlers each request processed once", async () => {
            const processed: string[] = [];

            const h1 = make();
            const h2 = make();
            await h1.handle(CREATE_WIDGET, "command", async (p) => {
                processed.push((p as WidgetPayload).widgetId);
            });
            await h2.handle(CREATE_WIDGET, "command", async (p) => {
                processed.push((p as WidgetPayload).widgetId);
            });

            const caller = make();
            const ids = Array.from({ length: 6 }, (_, i) => `cw-${i}`);
            for (const id of ids) {
                await caller.command(CREATE_WIDGET, { widgetId: id, name: id });
            }

            expect(processed).toHaveLength(6);
            expect(new Set(processed).size).toBe(6);
        });
    });
} else {
    describe("RedisSystemBus (skipped — set SYS_REDIS_URL to enable)", () => {
        it("test skipped", () => {
            /* no-op */
        });
    });
}
