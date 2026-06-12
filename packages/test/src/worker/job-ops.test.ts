/**
 * TRN-159: Integration tests for the read/ops surface (JobOps).
 *
 * Real SQLite (in-memory), real schema — no mocks.
 *
 * Covers:
 *   - listJobs: next run, enabled, required role, last outcome.
 *   - listDeadRuns / listStuckRuns selection.
 *   - enableJob / disableJob flip the flag and report hit/miss.
 *   - runNow enqueues a pending run and rejects unknown jobs.
 *   - requeueRun clones a dead run as a fresh pending attempt and rejects
 *     non-dead runs.
 */

import { createDataContext } from "@jasonscharf/data";
import {
    disableJob,
    enableJob,
    listDeadRuns,
    listJobs,
    listStuckRuns,
    requeueRun,
    runNow,
} from "@jasonscharf/worker";
import type { Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const NOW = new Date("2026-06-01T12:00:00.000Z");
const STALE_TIMEOUT_MS = 10 * 60 * 1_000;
let _seq = 0;

async function insertJob(
    knex: Knex,
    opts: { id: string; enabled?: boolean; nextRunAt?: Date; requiresRole?: string | null },
): Promise<void> {
    await knex("sys_job").insert({
        id: opts.id,
        schedule: JSON.stringify({ every: "PT1M" }),
        handler: "noop",
        requires_role: opts.requiresRole ?? null,
        enabled: opts.enabled ?? true,
        next_run_at: opts.nextRunAt ?? NOW,
        max_attempts: 3,
        meta: null,
    });
}

async function insertRun(
    knex: Knex,
    opts: {
        jobId: string;
        status: string;
        attempt?: number;
        scheduledFor?: Date;
        startedAt?: Date | null;
        finishedAt?: Date | null;
    },
): Promise<string> {
    const id = crypto.randomUUID();
    await knex("sys_job_run").insert({
        id,
        job_id: opts.jobId,
        scheduled_for: opts.scheduledFor ?? new Date(NOW.getTime() + _seq++),
        status: opts.status,
        attempt: opts.attempt ?? 1,
        claimed_by: null,
        started_at: opts.startedAt ?? null,
        finished_at: opts.finishedAt ?? null,
        error: null,
    });
    return id;
}

describe("JobOps — SQLite (in-memory)", () => {
    let knex: Knex;

    beforeEach(async () => {
        knex = await createDataContext({ client: "sqlite", filename: ":memory:" });
    });

    afterEach(async () => {
        await knex.destroy();
    });

    it("lists jobs with next run, required role, and last outcome", async () => {
        const next = new Date(NOW.getTime() + 60_000);
        await insertJob(knex, { id: "job.a", nextRunAt: next, requiresRole: "sys.scheduler" });
        await insertRun(knex, {
            jobId: "job.a",
            status: "succeeded",
            startedAt: new Date(NOW.getTime() - 10_000),
            finishedAt: new Date(NOW.getTime() - 9_000),
        });

        const summaries = await listJobs(knex);
        expect(summaries).toHaveLength(1);
        const s = summaries[0];
        expect(s.jobId).toBe("job.a");
        expect(s.enabled).toBe(true);
        expect(s.nextRunAt?.getTime()).toBe(next.getTime());
        expect(s.requiresRole).toBe("sys.scheduler");
        expect(s.lastStatus).toBe("succeeded");
        expect(s.consecutiveFailures).toBe(0);
    });

    it("lists dead runs and stuck running runs", async () => {
        await insertJob(knex, { id: "job.b" });

        const deadId = await insertRun(knex, {
            jobId: "job.b",
            status: "dead",
            finishedAt: new Date(NOW.getTime() - 5_000),
        });
        const stuckId = await insertRun(knex, {
            jobId: "job.b",
            status: "running",
            startedAt: new Date(NOW.getTime() - STALE_TIMEOUT_MS - 1_000),
        });
        // A fresh running run that is not yet stuck.
        await insertRun(knex, {
            jobId: "job.b",
            status: "running",
            startedAt: new Date(NOW.getTime() - 1_000),
        });

        const dead = await listDeadRuns(knex);
        expect(dead.map((r) => r.runId)).toEqual([deadId]);

        const stuck = await listStuckRuns(knex, {
            now: () => NOW,
            staleTimeoutMs: STALE_TIMEOUT_MS,
        });
        expect(stuck.map((r) => r.runId)).toEqual([stuckId]);
    });

    it("enables and disables a job, reporting hit/miss", async () => {
        await insertJob(knex, { id: "job.c", enabled: true });

        expect(await disableJob(knex, "job.c")).toBe(true);
        let row = await knex("sys_job").where({ id: "job.c" }).first();
        expect(row.enabled === false || row.enabled === 0).toBe(true);

        expect(await enableJob(knex, "job.c")).toBe(true);
        row = await knex("sys_job").where({ id: "job.c" }).first();
        expect(row.enabled === true || row.enabled === 1).toBe(true);

        // Unknown job → no row updated.
        expect(await enableJob(knex, "job.missing")).toBe(false);
    });

    it("runNow enqueues an immediate pending run and rejects unknown jobs", async () => {
        await insertJob(knex, { id: "job.d" });

        const runId = await runNow(knex, "job.d", { now: () => NOW });
        const row = await knex("sys_job_run").where({ id: runId }).first();
        expect(row.status).toBe("pending");
        expect(row.attempt).toBe(1);

        await expect(runNow(knex, "job.missing")).rejects.toThrow(/no job/i);
    });

    it("requeues a dead run as a fresh pending attempt and rejects non-dead runs", async () => {
        await insertJob(knex, { id: "job.e" });
        const deadId = await insertRun(knex, {
            jobId: "job.e",
            status: "dead",
            attempt: 3,
            finishedAt: new Date(NOW.getTime() - 1_000),
        });

        const newId = await requeueRun(knex, deadId, { now: () => NOW });
        const fresh = await knex("sys_job_run").where({ id: newId }).first();
        expect(fresh.status).toBe("pending");
        expect(fresh.attempt).toBe(1);
        expect(fresh.job_id).toBe("job.e");

        // Original dead row is preserved as an audit record.
        const original = await knex("sys_job_run").where({ id: deadId }).first();
        expect(original.status).toBe("dead");

        // A non-dead run cannot be requeued.
        const succeededId = await insertRun(knex, {
            jobId: "job.e",
            status: "succeeded",
            finishedAt: new Date(NOW.getTime() - 500),
        });
        await expect(requeueRun(knex, succeededId)).rejects.toThrow(/not "dead"|dead/i);
    });
});
