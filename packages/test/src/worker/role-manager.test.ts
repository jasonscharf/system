import { bindService } from "@jasonscharf/core";
/**
 * TRN-155: Integration tests for RoleManager.
 *
 * Two RoleManager instances share one SQLite (in-memory) DataContext so they
 * contend on the same sys_role_lease rows. Tests drive ticks explicitly and
 * use a controllable clock so takeover scenarios need no real sleeps.
 *
 * Why SQLite (in-memory):
 *   - Self-contained: no SYS_PG_URL required for CI.
 *   - The sys_role_lease schema and all Knex query idioms used by RoleManager
 *     (UPDATE...WHERE, INSERT...ON CONFLICT DO NOTHING) work identically on
 *     SQLite via better-sqlite3.
 *   - A single-connection pool means both managers share the same underlying
 *     database, exercising real contention on the same rows.
 *
 * Takeover timing without arbitrary sleeps:
 *   - Each manager is constructed with an injectable `now` clock function.
 *   - To simulate expiry we advance the clock past the TTL (while leaving the
 *     holder's timer stopped so it never renews), then call _tick() on the
 *     takeover candidate directly.
 *   - No setTimeout sleeps are used anywhere in these tests.
 *
 * Observing outRoleChanged:
 *   - The port is an FBP "out" port; messages travel via transports rather
 *     than direct on() callbacks. We attach a custom FlowTransport to each
 *     manager's port to capture events into a plain array.
 */

import { createDataContext, DataSource } from "@jasonscharf/data";
import { FlowContext, FlowTransport } from "@jasonscharf/flow";
import { type RoleChangeEvent, RoleManager } from "@jasonscharf/worker";
import type { Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * A mutable clock whose value can be advanced at will. Passed as `now` to
 * RoleManager so tests control time without real delays.
 */
class ManualClock {
    private _ms: number;

    constructor(initial: Date = new Date()) {
        this._ms = initial.getTime();
    }

    now(): Date {
        return new Date(this._ms);
    }

    /** Advance the clock by the given number of milliseconds. */
    advance(ms: number): void {
        this._ms += ms;
    }
}

/**
 * A simple sink transport that collects delivered messages into an array.
 * Used to observe outRoleChanged without needing a full FlowApp connection.
 */
class CollectorTransport<T> extends FlowTransport<T> {
    readonly received: T[] = [];

    override deliver(msg: T): void {
        this.received.push(msg);
    }
}

/**
 * Minimal FlowContext for testing — no scheduler needed since we invoke ticks
 * directly rather than through the FBP runtime.
 */
function makeFlowContext(): FlowContext {
    return new FlowContext();
}

/**
 * Create a RoleManager with a shared Knex instance and a controlled clock.
 * The manager is NOT initialised (onInit not called) so tick intervals don't
 * start automatically; tests drive ticks manually via the runTick helper.
 */
function makeManager(
    knex: Knex,
    clock: ManualClock,
    roles: { role: string; slots?: number }[],
    ttlMs = 30_000,
): RoleManager {
    return new RoleManager({
        context: makeFlowContext(),
        roles,
        ttlMs,
        now: () => clock.now(),
    });
}

/**
 * Attach a CollectorTransport to manager.outRoleChanged and return it.
 * Calling this before any ticks lets the test observe all role-change events.
 */
function collectEvents(manager: RoleManager): CollectorTransport<RoleChangeEvent> {
    const collector = new CollectorTransport<RoleChangeEvent>();
    // wire() from FlowTransport is not exported from @jasonscharf/flow so we
    // call addTransport directly. The transport's from/to are not needed for
    // a sink-style collector.
    collector._attach(manager.outRoleChanged, undefined);
    manager.outRoleChanged.addTransport(collector);
    return collector;
}

/**
 * Drive one acquire/renew tick on the manager without going through onInit
 * (which would also start the background interval).
 */
async function runTick(manager: RoleManager): Promise<void> {
    await (manager as unknown as { _tick(): Promise<void> })._tick();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("RoleManager — SQLite (in-memory)", () => {
    let knex: Knex;
    let clock: ManualClock;

    beforeEach(async () => {
        knex = await createDataContext({ client: "sqlite", filename: ":memory:" });
        bindService(DataSource, new DataSource(knex));
        clock = new ManualClock(new Date("2026-01-01T00:00:00Z"));
    });

    afterEach(async () => {
        await knex.destroy();
    });

    // ── cap-1: exactly one holder ─────────────────────────────────────────────

    it("with cap 1, exactly one manager holds the role after both tick", async () => {
        const m1 = makeManager(knex, clock, [{ role: "test.singleton" }]);
        const m2 = makeManager(knex, clock, [{ role: "test.singleton" }]);

        // Both tick at the same clock time — one wins the race, the other misses.
        await runTick(m1);
        await runTick(m2);

        const h1 = m1.holds("test.singleton");
        const h2 = m2.holds("test.singleton");

        // Exactly one holds it.
        expect(h1 !== h2).toBe(true);
    });

    // ── outRoleChanged events ─────────────────────────────────────────────────

    it("emits outRoleChanged with held=true when a lease is acquired", async () => {
        const m1 = makeManager(knex, clock, [{ role: "test.events" }]);
        const events = collectEvents(m1);

        await runTick(m1);

        expect(events.received).toHaveLength(1);
        expect(events.received[0]).toEqual({ role: "test.events", held: true });
    });

    // ── takeover: expired lease is claimed by the other manager ──────────────

    it("the other manager takes over when the holder stops renewing", async () => {
        const TTL_MS = 10_000;
        const m1 = makeManager(knex, clock, [{ role: "test.takeover" }], TTL_MS);
        const m2 = makeManager(knex, clock, [{ role: "test.takeover" }], TTL_MS);

        // m1 acquires the lease.
        await runTick(m1);
        expect(m1.holds("test.takeover")).toBe(true);
        expect(m2.holds("test.takeover")).toBe(false);

        // Advance the clock past the TTL — m1 no longer renews.
        clock.advance(TTL_MS + 1);

        // m2 should now claim the expired slot.
        await runTick(m2);
        expect(m2.holds("test.takeover")).toBe(true);

        // m1's renew will update 0 rows (the slot is now held by m2).
        await runTick(m1);
        expect(m1.holds("test.takeover")).toBe(false);
    });

    it("emits held=false when a renewal discovers the lease was taken", async () => {
        const TTL_MS = 10_000;
        const m1 = makeManager(knex, clock, [{ role: "test.lost" }], TTL_MS);
        const m2 = makeManager(knex, clock, [{ role: "test.lost" }], TTL_MS);

        await runTick(m1);
        expect(m1.holds("test.lost")).toBe(true);

        clock.advance(TTL_MS + 1);
        await runTick(m2);
        expect(m2.holds("test.lost")).toBe(true);

        // Register the collector AFTER m1 has already gained the role, so we
        // only see the loss event.
        const lostEvents = collectEvents(m1);

        // m1 tries to renew but the slot is now owned by m2.
        await runTick(m1);

        expect(lostEvents.received.some((e) => e.role === "test.lost" && !e.held)).toBe(true);
        expect(m1.holds("test.lost")).toBe(false);
    });

    // ── cap N: at most N concurrent holders ───────────────────────────────────

    it("with cap 2, at most 2 of 3 managers hold concurrently", async () => {
        const m1 = makeManager(knex, clock, [{ role: "test.multi", slots: 2 }]);
        const m2 = makeManager(knex, clock, [{ role: "test.multi", slots: 2 }]);
        const m3 = makeManager(knex, clock, [{ role: "test.multi", slots: 2 }]);

        await runTick(m1);
        await runTick(m2);
        await runTick(m3);

        const held = [m1, m2, m3].filter((m) => m.holds("test.multi")).length;
        expect(held).toBe(2);
    });

    // ── graceful dispose frees the slot immediately ───────────────────────────

    it("dispose releases the slot so the next manager acquires without waiting TTL", async () => {
        const TTL_MS = 60_000;
        const m1 = makeManager(knex, clock, [{ role: "test.dispose" }], TTL_MS);
        const m2 = makeManager(knex, clock, [{ role: "test.dispose" }], TTL_MS);

        await runTick(m1);
        expect(m1.holds("test.dispose")).toBe(true);

        // Graceful dispose: should null out holder_id without waiting for TTL.
        await m1.dispose();

        // Clock has NOT advanced — the lease would still be live if not released.
        // m2 should acquire immediately.
        await runTick(m2);
        expect(m2.holds("test.dispose")).toBe(true);
    });
});
