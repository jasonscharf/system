/**
 * TRN-159: Integration tests for per-job metrics + threshold alerting.
 *
 * Real SQLite (in-memory), real schema — no mocks. The alert sink is a real
 * collector function (an array push), per the no-spies rule: ports/collectors
 * are the observability layer.
 *
 * Covers:
 *   - last run time / status / duration / scheduling lag from the latest run.
 *   - consecutiveFailures counts trailing failed/dead runs and resets on success.
 *   - a job with no terminal runs reports nulls + zero failures.
 *   - emitJobMetrics warns only for jobs at/over the threshold.
 */

import { createDataContext } from "@jasonscharf/data";
import { computeJobMetrics, emitJobMetrics, type JobMetricAlert } from "@jasonscharf/worker";
import type { Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ── Constants ───────────────────────────────────────────────────────────────

const NOW = new Date("2026-06-01T12:00:00.000Z");
let _seq = 0;

// ── Helpers ─────────────────────────────────────────────────────────────────

async function insertJob(knex: Knex, id: string, enabled = true): Promise<void> {
    await knex("sys_job").insert({
        id,
        schedule: JSON.stringify({ every: "PT1M" }),
        handler: "noop",
        requires_role: null,
        enabled,
        next_run_at: NOW,
        max_attempts: 5,
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
): Promise<void> {
    await knex("sys_job_run").insert({
        id: crypto.randomUUID(),
        job_id: opts.jobId,
        scheduled_for: opts.scheduledFor ?? new Date(NOW.getTime() + _seq++),
        status: opts.status,
        attempt: opts.attempt ?? 1,
        claimed_by: null,
        started_at: opts.startedAt ?? null,
        finished_at: opts.finishedAt ?? null,
        error: null,
    });
}

function metricFor(metrics: Awaited<ReturnType<typeof computeJobMetrics>>, jobId: string) {
    const m = metrics.find((x) => x.jobId === jobId);
    if (m === undefined) {
        throw new Error(`no metric for ${jobId}`);
    }
    return m;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("JobMetrics — SQLite (in-memory)", () => {
    let knex: Knex;

    beforeEach(async () => {
        knex = await createDataContext({ client: "sqlite", filename: ":memory:" });
    });

    afterEach(async () => {
        await knex.destroy();
    });

    it("derives last run time, status, duration and scheduling lag from the latest run", async () => {
        await insertJob(knex, "job.ok");
        const scheduledFor = new Date(NOW.getTime() - 60_000);
        const startedAt = new Date(NOW.getTime() - 55_000); // 5s scheduling lag
        const finishedAt = new Date(NOW.getTime() - 53_000); // 2s duration
        await insertRun(knex, {
            jobId: "job.ok",
            status: "succeeded",
            scheduledFor,
            startedAt,
            finishedAt,
        });

        const metrics = await computeJobMetrics(knex);
        const m = metricFor(metrics, "job.ok");

        expect(m.lastStatus).toBe("succeeded");
        expect(m.lastRunAt?.getTime()).toBe(startedAt.getTime());
        expect(m.lastDurationMs).toBe(2_000);
        expect(m.schedulingLagMs).toBe(5_000);
        expect(m.consecutiveFailures).toBe(0);
    });

    it("counts consecutive trailing failures and resets on the last success", async () => {
        await insertJob(knex, "job.flaky");
        // Oldest → newest: succeeded, failed, failed, dead.
        // started_at ascending so "most recent" is the dead one.
        await insertRun(knex, {
            jobId: "job.flaky",
            status: "succeeded",
            attempt: 1,
            startedAt: new Date(NOW.getTime() - 40_000),
        });
        await insertRun(knex, {
            jobId: "job.flaky",
            status: "failed",
            attempt: 2,
            startedAt: new Date(NOW.getTime() - 30_000),
        });
        await insertRun(knex, {
            jobId: "job.flaky",
            status: "failed",
            attempt: 3,
            startedAt: new Date(NOW.getTime() - 20_000),
        });
        await insertRun(knex, {
            jobId: "job.flaky",
            status: "dead",
            attempt: 4,
            startedAt: new Date(NOW.getTime() - 10_000),
        });

        const m = metricFor(await computeJobMetrics(knex), "job.flaky");
        expect(m.lastStatus).toBe("dead");
        expect(m.consecutiveFailures).toBe(3);
    });

    it("reports nulls and zero failures for a job with no terminal runs", async () => {
        await insertJob(knex, "job.fresh");
        // Only a pending run — not terminal.
        await insertRun(knex, { jobId: "job.fresh", status: "pending" });

        const m = metricFor(await computeJobMetrics(knex), "job.fresh");
        expect(m.lastRunAt).toBeNull();
        expect(m.lastStatus).toBeNull();
        expect(m.lastDurationMs).toBeNull();
        expect(m.schedulingLagMs).toBeNull();
        expect(m.consecutiveFailures).toBe(0);
    });

    it("emits a warn alert only for jobs at or over the threshold", async () => {
        await insertJob(knex, "job.healthy");
        await insertRun(knex, {
            jobId: "job.healthy",
            status: "succeeded",
            startedAt: new Date(NOW.getTime() - 10_000),
        });

        await insertJob(knex, "job.failing");
        for (let i = 0; i < 3; i++) {
            await insertRun(knex, {
                jobId: "job.failing",
                status: "failed",
                attempt: i + 1,
                startedAt: new Date(NOW.getTime() - (30_000 - i * 10_000)),
            });
        }

        const alerts: JobMetricAlert[] = [];
        await emitJobMetrics(knex, { log: (a) => alerts.push(a), threshold: 3 });

        expect(alerts).toHaveLength(1);
        expect(alerts[0].level).toBe("warn");
        expect(alerts[0].metric.jobId).toBe("job.failing");
        expect(alerts[0].metric.consecutiveFailures).toBe(3);
    });
});
