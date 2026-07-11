/**
 * TRN-159: Integration tests for the stale-run reaper (sys.jobs.reap).
 *
 * Real SQLite (in-memory), real schema, real transactions — no mocks. The
 * reaper's clock and stale threshold are injected so the "stale" boundary is
 * deterministic; rows are inserted with explicit started_at offsets.
 *
 * Covers:
 *   - Stale running run with attempts remaining → failed + a fresh pending retry.
 *   - Stale running run with attempts exhausted → dead, no retry enqueued.
 *   - A fresh running run (within the timeout) is left untouched.
 *   - Non-running rows (pending / succeeded / dead) are never touched.
 */

import { systemSec } from "@jasonscharf/core";
import { createDataContext } from "@jasonscharf/data";
import { createStaleRunReaper, type JobContext, type JobHandler } from "@jasonscharf/worker";
import type { Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ── Constants ───────────────────────────────────────────────────────────────

const NOW = new Date("2026-06-01T12:00:00.000Z");
const STALE_TIMEOUT_MS = 10 * 60 * 1_000; // 10 minutes

// ── Helpers ─────────────────────────────────────────────────────────────────

async function runHandler(knex: Knex, handler: JobHandler): Promise<void> {
    await knex.transaction(async (trx) => {
        const ctx: JobContext = { knex, trx, sec: systemSec, tenantId: null };
        await handler(ctx, {});
    });
}

async function insertJob(knex: Knex, opts: { id: string; maxAttempts?: number }): Promise<void> {
    await knex("sys_job").insert({
        id: opts.id,
        schedule: JSON.stringify({ every: "PT1M" }),
        handler: "noop",
        requires_role: null,
        enabled: true,
        next_run_at: NOW,
        max_attempts: opts.maxAttempts ?? 3,
        meta: null,
    });
}

async function insertRun(
    knex: Knex,
    opts: {
        jobId: string;
        status: string;
        attempt?: number;
        startedAt?: Date | null;
        scheduledFor?: Date;
        finishedAt?: Date | null;
    },
): Promise<string> {
    const id = crypto.randomUUID();
    // Unique scheduled_for per row so multiple runs for one job don't collide
    // on unique(job_id, scheduled_for, attempt). Reaping keys off status +
    // started_at, not scheduled_for, so the exact value is irrelevant here.
    const scheduledFor = opts.scheduledFor ?? new Date(NOW.getTime() + _seq++);
    await knex("sys_job_run").insert({
        id,
        job_id: opts.jobId,
        scheduled_for: scheduledFor,
        status: opts.status,
        attempt: opts.attempt ?? 1,
        claimed_by: opts.status === "running" ? "runner-test" : null,
        started_at: opts.startedAt ?? null,
        finished_at: opts.finishedAt ?? null,
        error: null,
    });
    return id;
}

function getRun(knex: Knex, id: string) {
    return knex("sys_job_run").where({ id }).first();
}

function runsForJob(knex: Knex, jobId: string) {
    return knex("sys_job_run").where({ job_id: jobId }).orderBy("attempt", "asc").select("*");
}

// A started_at comfortably past the stale boundary.
const STALE_STARTED_AT = new Date(NOW.getTime() - STALE_TIMEOUT_MS - 1_000);

// Monotonic sequence to give each inserted run a distinct scheduled_for.
let _seq = 0;

// ── Tests ───────────────────────────────────────────────────────────────────

describe("StaleRunReaper — SQLite (in-memory)", () => {
    let knex: Knex;
    let reaper: JobHandler;

    beforeEach(async () => {
        knex = await createDataContext({ client: "sqlite", filename: ":memory:" });
        reaper = createStaleRunReaper({ now: () => NOW, staleTimeoutMs: STALE_TIMEOUT_MS });
    });

    afterEach(async () => {
        await knex.destroy();
    });

    it("fails a stale running run with attempts remaining and enqueues a retry", async () => {
        await insertJob(knex, { id: "job.stale", maxAttempts: 3 });
        const staleId = await insertRun(knex, {
            jobId: "job.stale",
            status: "running",
            attempt: 1,
            startedAt: STALE_STARTED_AT,
        });

        await runHandler(knex, reaper);

        const original = await getRun(knex, staleId);
        expect(original.status).toBe("failed");
        expect(original.finished_at).not.toBeNull();
        expect(original.error).toMatch(/reaped/i);

        const all = await runsForJob(knex, "job.stale");
        expect(all).toHaveLength(2);
        const retry = all[1];
        expect(retry.attempt).toBe(2);
        expect(retry.status).toBe("pending");
        expect(retry.started_at).toBeNull();
    });

    it("marks a stale running run dead when attempts are exhausted", async () => {
        await insertJob(knex, { id: "job.exhausted", maxAttempts: 2 });
        const staleId = await insertRun(knex, {
            jobId: "job.exhausted",
            status: "running",
            attempt: 2,
            startedAt: STALE_STARTED_AT,
        });

        await runHandler(knex, reaper);

        const original = await getRun(knex, staleId);
        expect(original.status).toBe("dead");
        expect(original.error).toMatch(/reaped/i);

        // No retry enqueued — this was the final attempt.
        const all = await runsForJob(knex, "job.exhausted");
        expect(all).toHaveLength(1);
    });

    it("leaves a fresh running run (within the timeout) untouched", async () => {
        await insertJob(knex, { id: "job.fresh", maxAttempts: 3 });
        const freshStartedAt = new Date(NOW.getTime() - 1_000); // 1s ago, not stale
        const freshId = await insertRun(knex, {
            jobId: "job.fresh",
            status: "running",
            attempt: 1,
            startedAt: freshStartedAt,
        });

        await runHandler(knex, reaper);

        const row = await getRun(knex, freshId);
        expect(row.status).toBe("running");
        const all = await runsForJob(knex, "job.fresh");
        expect(all).toHaveLength(1);
    });

    it("never touches non-running rows regardless of age", async () => {
        await insertJob(knex, { id: "job.mixed", maxAttempts: 3 });
        const old = new Date(NOW.getTime() - STALE_TIMEOUT_MS - 60_000);
        const pendingId = await insertRun(knex, {
            jobId: "job.mixed",
            status: "pending",
            scheduledFor: old,
        });
        const succeededId = await insertRun(knex, {
            jobId: "job.mixed",
            status: "succeeded",
            startedAt: old,
            finishedAt: old,
        });
        const deadId = await insertRun(knex, {
            jobId: "job.mixed",
            status: "dead",
            startedAt: old,
            finishedAt: old,
        });

        await runHandler(knex, reaper);

        expect((await getRun(knex, pendingId)).status).toBe("pending");
        expect((await getRun(knex, succeededId)).status).toBe("succeeded");
        expect((await getRun(knex, deadId)).status).toBe("dead");
        const all = await runsForJob(knex, "job.mixed");
        expect(all).toHaveLength(3);
    });
});
