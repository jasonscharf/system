/**
 * Dispatch message-type tests — command, event, query, operation across BOTH
 * the in-process transport (InMemorySystemBus) and a REAL queue (RedisSystemBus
 * against the shared dev Redis).  No mocks: every handler is a real exported
 * function resolved through the module-ref loader and run by the Runner, and
 * every cross-process assertion observes a real side effect or a real reply
 * carried back over Redis.
 *
 * The Redis suite runs when SYS_REDIS_URL is set.
 */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { _clearModuleRefCache, InMemorySystemBus, type ISystemBus } from "@jasonscharf/core";
import {
    BusDispatchProvider,
    DefRegistry,
    DispatchHost,
    RedisSystemBus,
} from "@jasonscharf/events";
import { Redis } from "ioredis";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetSideEffects, resetStore, sideEffects, store } from "./__fixtures__/handlers.js";

// The names this suite dispatches, contributed to the ambient registries the
// same way a real consumer/extension would — so exec() args are type-checked.
declare module "@jasonscharf/events" {
    interface CommandRegistry {
        "view.activate": { viewId: string };
        "view.fail": { viewId: string };
    }
    interface EventRegistry {
        "view.activated": { viewId: string };
    }
    interface QueryRegistry {
        "view.list": { id: number };
    }
    interface QueryResultRegistry {
        "view.list": { count: number; rows: Array<{ id: number; kind: string }> };
    }
    interface OperationRegistry {
        "view.bump": { key: string; by: number };
    }
    interface OperationResultRegistry {
        "view.bump": { key: string; value: number };
    }
}

// ── Fixture module-refs ──────────────────────────────────────────────────────────

const FIXTURE = resolve(new URL(import.meta.url).pathname, "../__fixtures__/handlers.ts");
const FIXTURE_URL = pathToFileURL(FIXTURE).href;

function ref(member: string): string {
    return `module://${FIXTURE_URL}#${member}`;
}

// ── Shared registry wiring ───────────────────────────────────────────────────────

function buildRegistry(): DefRegistry {
    const registry = new DefRegistry();
    registry.registerCommand("view.activate", {
        invocations: [ref("recordActivate"), ref("recordFocus")],
    });
    registry.registerCommand("view.fail", {
        invocations: [ref("alwaysThrows")],
    });
    registry.registerEvent("view.activated", {
        invocations: [ref("recordActivate")],
    });
    registry.registerQuery("view.list", {
        invocations: [ref("rowFromArg"), ref("staticRow")],
        reducers: [ref("countReducer")],
    });
    registry.registerOperation("view.bump", {
        invocations: [ref("incrementStore")],
        reducers: [ref("firstResult")],
    });
    return registry;
}

// ── Shared contract suite (runs against any ISystemBus) ──────────────────────────

function dispatchSuite(name: string, makeBus: () => ISystemBus): void {
    describe(name, () => {
        let bus: ISystemBus;
        let host: DispatchHost;
        let dispatch: BusDispatchProvider;

        beforeEach(async () => {
            resetSideEffects();
            resetStore();
            _clearModuleRefCache();

            bus = makeBus();
            const registry = buildRegistry();
            host = new DispatchHost(bus, registry);
            dispatch = new BusDispatchProvider(bus);

            await host.bind("command", "view.activate");
            await host.bind("command", "view.fail");
            await host.bind("event", "view.activated");
            await host.bind("query", "view.list");
            await host.bind("operation", "view.bump");
        });

        afterEach(async () => {
            await bus.close();
        });

        it("command runs its full invocation sequence and resolves void", async () => {
            const result = await dispatch.command("view.activate").exec({ viewId: "v1" });
            expect(result).toBeUndefined();
            // Both steps ran, in order — proving the sequence and the ack round-trip.
            expect(sideEffects).toEqual(["activate:v1", "focus:v1"]);
        });

        it("event runs and resolves void with the same ack contract as command", async () => {
            const result = await dispatch.event("view.activated").exec({ viewId: "e1" });
            expect(result).toBeUndefined();
            expect(sideEffects).toEqual(["activate:e1"]);
        });

        it("command Error propagates across the channel and throws from exec()", async () => {
            await expect(dispatch.command("view.fail").exec({ viewId: "x" })).rejects.toThrow(
                /boom from handler/,
            );
        });

        it("query returns a reduced data set via the reducers pipeline", async () => {
            // The return type flows from the ambient QueryResultRegistry — no cast.
            const data = await dispatch.query("view.list").exec({ id: 7 });
            expect(data.count).toBe(2);
            expect(data.rows).toEqual([
                { id: 7, kind: "row" },
                { id: 99, kind: "static" },
            ]);
        });

        it("operation mutates and returns the new value over the same channel", async () => {
            const first = await dispatch.operation("view.bump").exec({ key: "a", by: 3 });
            expect(first).toEqual({ key: "a", value: 3 });

            const second = await dispatch.operation("view.bump").exec({ key: "a", by: 4 });
            expect(second).toEqual({ key: "a", value: 7 });
            // The mutation is real and accumulated.
            expect(store.a).toBe(7);
        });
    });
}

// ── In-process ───────────────────────────────────────────────────────────────────

dispatchSuite("InMemorySystemBus (in-process)", () => new InMemorySystemBus());

// ── Real queue (Redis) ───────────────────────────────────────────────────────────

if (process.env.SYS_REDIS_URL) {
    const redisUrl = process.env.SYS_REDIS_URL as string;

    describe("RedisSystemBus (real queue)", () => {
        // Unique prefix per run so concurrent siblings never collide on the shared
        // Redis (it is a host-wide singleton).
        const prefix = `urn:sys:test:dispatch:${Math.random().toString(36).slice(2, 10)}`;

        // The bus does not own the connection it is handed; quit each after use.
        const redisConns: Redis[] = [];
        afterEach(async () => {
            for (const r of redisConns.splice(0)) {
                await r.quit().catch(() => {});
            }
        });

        dispatchSuite("across Redis queue", () => {
            const redis = new Redis(redisUrl);
            redisConns.push(redis);
            return new RedisSystemBus(redis, { keyPrefix: prefix, requestTimeoutMs: 8000 });
        });
    });
} else {
    describe("RedisSystemBus (real queue) (skipped — set SYS_REDIS_URL to enable)", () => {
        it("test skipped", () => {
            /* no-op */
        });
    });
}
