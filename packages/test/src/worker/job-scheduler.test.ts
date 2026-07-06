import { bindService } from "@jasonscharf/core";
/**
 * TRN-156: Integration tests for JobScheduler.
 *
 * Uses SQLite in-memory (via createDataContext) — real DB, real schema,
 * no mocks. Tests drive _tick() directly without going through onInit so
 * no background setInterval fires during tests.
 *
 * Covers:
 *   - A due job produces exactly one sys_job_run and advances next_run_at.
 *   - Idle when isActive() is false (no runs created).
 *   - Two scheduler instances ticking the same due job → exactly one run (UNIQUE).
 *   - Down-then-up: a job with a stale next_run_at produces ONE catch-up run.
 *
 * No arbitrary setTimeout sleeps. The injectable clock is advanced via
 * ManualClock; _tick() is invoked directly.
 */

import { createDataContext, DataSource } from "@jasonscharf/data";
import { FlowContext } from "@jasonscharf/flow";
import { JobScheduler } from "@jasonscharf/worker";
import type { Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ── Helpers ───────────────────────────────────────────────────────────────────

class ManualClock {
    private _ms: number;

    constructor(initial: Date = new Date()) {
        this._ms = initial.getTime();
    }

    now(): Date {
        return new Date(this._ms);
    }

    advance(ms: number): void {
        this._ms += ms;
    }

    set(date: Date): void {
        this._ms = date.getTime();
    }
}

function makeFlowContext(): FlowContext {
    return new FlowContext();
}

function makeScheduler(knex: Knex, clock: ManualClock, isActive: () => boolean): JobScheduler {
    return new JobScheduler({
        context: makeFlowContext(),
        isActive,
        now: () => clock.now(),
        // Use a very long tick interval so the background timer never fires.
        tickIntervalMs: 1_000_000,
    });
}

/**
 * Drive one tick on the scheduler without going through onInit
 * (which would start the background interval).
 */
async function runTick(scheduler: JobScheduler): Promise<void> {
    await (scheduler as unknown as { _tick(): Promise<void> })._tick();
}

/**
 * Insert a sys_job row with next_run_at in the past (due immediately).
 * Returns the job id.
 */
async function insertDueJob(
    knex: Knex,
    id: string,
    schedule: object,
    nextRunAt: Date,
): Promise<string> {
    await knex("sys_job").insert({
        id,
        schedule: JSON.stringify(schedule),
        handler: "test://noop",
        requires_role: null,
        enabled: true,
        next_run_at: nextRunAt,
        max_attempts: 1,
        meta: null,
    });
    return id;
}

/**
 * Fetch all sys_job_run rows for a given job id.
 */
async function getRunsForJob(knex: Knex, jobId: string) {
    return knex("sys_job_run").where({ job_id: jobId }).select("*");
}

/**
 * Fetch the current next_run_at for a job.
 */
async function getNextRunAt(knex: Knex, jobId: string): Promise<Date> {
    const row = await knex("sys_job").where({ id: jobId }).select("next_run_at").first();
    return new Date(row.next_run_at as string | Date);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("JobScheduler — SQLite (in-memory)", () => {
    let knex: Knex;
    let clock: ManualClock;

    const NOW = new Date("2026-06-01T12:00:00.000Z");

    beforeEach(async () => {
        knex = await createDataContext({ client: "sqlite", filename: ":memory:" });
        bindService(DataSource, new DataSource(knex));
        clock = new ManualClock(NOW);
    });

    afterEach(async () => {
        await knex.destroy();
    });

    // ── A due job produces exactly one run ────────────────────────────────────

    it("a due job produces exactly one sys_job_run and advances next_run_at", async () => {
        const dueAt = new Date(NOW.getTime() - 1_000); // 1 second in the past
        await insertDueJob(knex, "job-due-1", { every: "PT30S" }, dueAt);

        const scheduler = makeScheduler(knex, clock, () => true);
        await runTick(scheduler);

        const runs = await getRunsForJob(knex, "job-due-1");
        expect(runs).toHaveLength(1);
        expect(runs[0].status).toBe("pending");
        expect(runs[0].attempt).toBe(1);
        expect(runs[0].job_id).toBe("job-due-1");

        const nextRunAt = await getNextRunAt(knex, "job-due-1");
        // next_run_at should be advanced from NOW (not from stale dueAt)
        // nextRun({ every: "PT30S" }, NOW) = NOW + 30s
        expect(nextRunAt.getTime()).toBeCloseTo(NOW.getTime() + 30_000, -2);
    });

    // ── Idle when isActive() is false ─────────────────────────────────────────

    it("does not create runs when isActive() returns false", async () => {
        const dueAt = new Date(NOW.getTime() - 1_000);
        await insertDueJob(knex, "job-inactive-1", { every: "PT30S" }, dueAt);

        const scheduler = makeScheduler(knex, clock, () => false);
        await runTick(scheduler);

        const runs = await getRunsForJob(knex, "job-inactive-1");
        expect(runs).toHaveLength(0);

        // next_run_at should be unchanged
        const nextRunAt = await getNextRunAt(knex, "job-inactive-1");
        expect(nextRunAt.getTime()).toBe(dueAt.getTime());
    });

    // ── Race: two schedulers on the same due job → exactly one run ────────────

    it("two schedulers ticking the same due job produce exactly one run", async () => {
        const dueAt = new Date(NOW.getTime() - 1_000);
        await insertDueJob(knex, "job-race-1", { every: "PT30S" }, dueAt);

        const s1 = makeScheduler(knex, clock, () => true);
        const s2 = makeScheduler(knex, clock, () => true);

        // Both tick. SQLite serialises writers so one wins and the other gets
        // a UNIQUE conflict which the scheduler silently ignores.
        await Promise.all([runTick(s1), runTick(s2)]);

        const runs = await getRunsForJob(knex, "job-race-1");
        expect(runs).toHaveLength(1);
    });

    // ── Catch-up: stale next_run_at folds into one run ────────────────────────

    it("a job overdue by many periods produces ONE catch-up run, not a backlog", async () => {
        // Schedule: every 30s. next_run_at is 10 minutes in the past.
        const dueAt = new Date(NOW.getTime() - 10 * 60 * 1_000); // 10 minutes ago
        await insertDueJob(knex, "job-catchup-1", { every: "PT30S" }, dueAt);

        const scheduler = makeScheduler(knex, clock, () => true);
        await runTick(scheduler);

        // Should produce exactly one run, not ~20 catch-up runs.
        const runs = await getRunsForJob(knex, "job-catchup-1");
        expect(runs).toHaveLength(1);
        expect(runs[0].status).toBe("pending");

        // next_run_at should be NOW + 30s (computed from NOW, not from dueAt)
        const nextRunAt = await getNextRunAt(knex, "job-catchup-1");
        expect(nextRunAt.getTime()).toBeCloseTo(NOW.getTime() + 30_000, -2);
    });

    // ── Not-yet-due jobs are not processed ────────────────────────────────────

    it("does not process jobs whose next_run_at is in the future", async () => {
        const futureAt = new Date(NOW.getTime() + 60_000); // 1 minute from now
        await insertDueJob(knex, "job-future-1", { every: "PT30S" }, futureAt);

        const scheduler = makeScheduler(knex, clock, () => true);
        await runTick(scheduler);

        const runs = await getRunsForJob(knex, "job-future-1");
        expect(runs).toHaveLength(0);
    });

    // ── Disabled jobs are not processed ──────────────────────────────────────

    it("does not process disabled jobs", async () => {
        const dueAt = new Date(NOW.getTime() - 1_000);
        await knex("sys_job").insert({
            id: "job-disabled-1",
            schedule: JSON.stringify({ every: "PT30S" }),
            handler: "test://noop",
            requires_role: null,
            enabled: false, // disabled
            next_run_at: dueAt,
            max_attempts: 1,
            meta: null,
        });

        const scheduler = makeScheduler(knex, clock, () => true);
        await runTick(scheduler);

        const runs = await getRunsForJob(knex, "job-disabled-1");
        expect(runs).toHaveLength(0);
    });

    // ── Multiple due jobs all get a run ───────────────────────────────────────

    it("processes multiple due jobs in one tick", async () => {
        const dueAt = new Date(NOW.getTime() - 1_000);
        await insertDueJob(knex, "job-multi-1", { every: "PT30S" }, dueAt);
        await insertDueJob(knex, "job-multi-2", { every: "PT1M" }, dueAt);

        const scheduler = makeScheduler(knex, clock, () => true);
        await runTick(scheduler);

        const runs1 = await getRunsForJob(knex, "job-multi-1");
        const runs2 = await getRunsForJob(knex, "job-multi-2");

        expect(runs1).toHaveLength(1);
        expect(runs2).toHaveLength(1);
    });

    // ── Daily schedule advances next_run_at to the next wall-clock occurrence ─

    it("advances next_run_at correctly for a daily schedule", async () => {
        // Job fires daily at 03:00 UTC. Clock is at 12:00 UTC.
        const dueAt = new Date(NOW.getTime() - 1_000);
        await insertDueJob(knex, "job-daily-1", { daily: "03:00", tz: "UTC" }, dueAt);

        const scheduler = makeScheduler(knex, clock, () => true);
        await runTick(scheduler);

        const runs = await getRunsForJob(knex, "job-daily-1");
        expect(runs).toHaveLength(1);

        // nextRun({ daily: "03:00", tz: "UTC" }, 2026-06-01T12:00Z)
        // → 2026-06-02T03:00Z (next occurrence after noon today)
        const nextRunAt = await getNextRunAt(knex, "job-daily-1");
        expect(nextRunAt.toISOString()).toBe("2026-06-02T03:00:00.000Z");
    });
});
