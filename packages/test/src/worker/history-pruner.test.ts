/**
 * TRN-159: Integration tests for the history pruner (sys.jobs.prune).
 *
 * Real SQLite (in-memory), real schema, real transactions — no mocks. The
 * pruner's clock and retention windows are injected so the cutoffs are
 * deterministic; rows are inserted with explicit finished_at offsets.
 *
 * Covers:
 *   - succeeded/failed rows past the short window are deleted.
 *   - dead rows are kept longer than succeeded of the same age (window split).
 *   - dead rows past the long window are deleted.
 *   - pending / running rows are never deleted regardless of age.
 */

import { systemSec } from "@jasonscharf/core";
import { createDataContext } from "@jasonscharf/data";
import { createHistoryPruner, type JobContext, type JobHandler } from "@jasonscharf/worker";
import type { Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ── Constants ───────────────────────────────────────────────────────────────

const NOW = new Date("2026-06-01T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1_000;
const SHORT_RETENTION_MS = 7 * DAY_MS;
const LONG_RETENTION_MS = 30 * DAY_MS;

function daysAgo(n: number): Date {
    return new Date(NOW.getTime() - n * DAY_MS);
}

// Monotonic sequence to give each inserted run a distinct scheduled_for.
let _seq = 0;

// ── Helpers ─────────────────────────────────────────────────────────────────

async function runHandler(knex: Knex, handler: JobHandler): Promise<void> {
    await knex.transaction(async (trx) => {
        const ctx: JobContext = { knex, trx, sec: systemSec, tenantId: null };
        await handler(ctx, {});
    });
}

async function insertJob(knex: Knex, id: string): Promise<void> {
    await knex("sys_job").insert({
        id,
        schedule: JSON.stringify({ every: "P1D" }),
        handler: "noop",
        requires_role: null,
        enabled: true,
        next_run_at: NOW,
        max_attempts: 3,
        meta: null,
    });
}

async function insertRun(
    knex: Knex,
    opts: {
        jobId: string;
        status: string;
        finishedAt?: Date | null;
        scheduledFor?: Date;
        startedAt?: Date | null;
    },
): Promise<string> {
    const id = crypto.randomUUID();
    // Unique scheduled_for per row so multiple runs for one job don't collide
    // on unique(job_id, scheduled_for, attempt). Pruning keys off finished_at,
    // not scheduled_for, so the exact value is irrelevant here.
    const scheduledFor = opts.scheduledFor ?? new Date(NOW.getTime() + _seq++);
    await knex("sys_job_run").insert({
        id,
        job_id: opts.jobId,
        scheduled_for: scheduledFor,
        status: opts.status,
        attempt: 1,
        claimed_by: null,
        started_at: opts.startedAt ?? null,
        finished_at: opts.finishedAt ?? null,
        error: null,
    });
    return id;
}

function exists(knex: Knex, id: string): Promise<boolean> {
    return knex("sys_job_run")
        .where({ id })
        .first()
        .then((row) => row != null);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("HistoryPruner — SQLite (in-memory)", () => {
    let knex: Knex;
    let pruner: JobHandler;

    beforeEach(async () => {
        knex = await createDataContext({ client: "sqlite", filename: ":memory:" });
        pruner = createHistoryPruner({
            now: () => NOW,
            succeededRetentionMs: SHORT_RETENTION_MS,
            deadRetentionMs: LONG_RETENTION_MS,
        });
        await insertJob(knex, "job.hist");
    });

    afterEach(async () => {
        await knex.destroy();
    });

    it("deletes succeeded/failed rows past the short window but keeps recent ones", async () => {
        const oldSucceeded = await insertRun(knex, {
            jobId: "job.hist",
            status: "succeeded",
            finishedAt: daysAgo(8),
        });
        const oldFailed = await insertRun(knex, {
            jobId: "job.hist",
            status: "failed",
            finishedAt: daysAgo(8),
        });
        const recentSucceeded = await insertRun(knex, {
            jobId: "job.hist",
            status: "succeeded",
            finishedAt: daysAgo(1),
        });

        await runHandler(knex, pruner);

        expect(await exists(knex, oldSucceeded)).toBe(false);
        expect(await exists(knex, oldFailed)).toBe(false);
        expect(await exists(knex, recentSucceeded)).toBe(true);
    });

    it("keeps dead rows longer than succeeded rows of the same age", async () => {
        // 10 days old: past the 7-day short window, within the 30-day long window.
        const succeeded = await insertRun(knex, {
            jobId: "job.hist",
            status: "succeeded",
            finishedAt: daysAgo(10),
        });
        const dead = await insertRun(knex, {
            jobId: "job.hist",
            status: "dead",
            finishedAt: daysAgo(10),
        });

        await runHandler(knex, pruner);

        expect(await exists(knex, succeeded)).toBe(false);
        expect(await exists(knex, dead)).toBe(true);
    });

    it("deletes dead rows past the long window", async () => {
        const oldDead = await insertRun(knex, {
            jobId: "job.hist",
            status: "dead",
            finishedAt: daysAgo(31),
        });

        await runHandler(knex, pruner);

        expect(await exists(knex, oldDead)).toBe(false);
    });

    it("never deletes pending or running rows regardless of age", async () => {
        const oldPending = await insertRun(knex, {
            jobId: "job.hist",
            status: "pending",
            scheduledFor: daysAgo(100),
        });
        const oldRunning = await insertRun(knex, {
            jobId: "job.hist",
            status: "running",
            startedAt: daysAgo(100),
        });

        await runHandler(knex, pruner);

        expect(await exists(knex, oldPending)).toBe(true);
        expect(await exists(knex, oldRunning)).toBe(true);
    });
});
