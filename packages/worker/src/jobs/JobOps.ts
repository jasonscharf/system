/**
 * TRN-159: Read + ops surface for jobs and runs.
 *
 * The functional core behind an inspection/admin API — thin, ctx-free DB
 * helpers that a transport (HTTP handler, CLI, admin UI) can call directly.
 * Exposing them over a wire is deferred to wherever the platform standardises
 * ops endpoints; the logic and its guarantees live (and are tested) here.
 *
 * Reads:
 *   - listJobs       — every job with next_run, enabled, and its last outcome.
 *   - listDeadRuns   — runs that exhausted their attempts (need attention).
 *   - listStuckRuns  — runs stuck in `running` past a staleness threshold.
 *
 * Controls:
 *   - enableJob / disableJob — flip sys_job.enabled.
 *   - runNow                 — enqueue an immediate pending run.
 *   - requeueRun             — re-enqueue a dead run as a fresh attempt.
 *
 * All reads issue a bounded number of queries (no per-row query loop).
 */

import type { Knex } from "knex";
import { REAPER_STALE_TIMEOUT_MS } from "../config.js";
import { computeJobMetrics } from "./JobMetrics.js";

function _toDate(value: Date | string | null): Date | null {
    if (value === null || value === undefined) {
        return null;
    }
    return value instanceof Date ? value : new Date(value);
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export interface JobSummary {
    jobId: string;
    enabled: boolean;
    nextRunAt: Date | null;
    requiresRole: string | null;
    lastStatus: string | null;
    lastRunAt: Date | null;
    consecutiveFailures: number;
}

interface JobRow {
    id: string;
    enabled: boolean | number;
    next_run_at: Date | string | null;
    requires_role: string | null;
}

/**
 * List every job with its next scheduled run, enabled flag, required role, and
 * last outcome (status + time + consecutive-failure count). Two bounded queries:
 * the job rows here plus the history fold in computeJobMetrics.
 */
export async function listJobs(knex: Knex): Promise<JobSummary[]> {
    const [jobs, metrics] = await Promise.all([
        knex<JobRow>("sys_job")
            .select("id", "enabled", "next_run_at", "requires_role")
            .orderBy("id", "asc"),
        computeJobMetrics(knex),
    ]);

    const metricByJob = new Map(metrics.map((m) => [m.jobId, m]));

    return jobs.map((job) => {
        const metric = metricByJob.get(job.id);
        return {
            jobId: job.id,
            enabled: job.enabled === true || job.enabled === 1,
            nextRunAt: _toDate(job.next_run_at),
            requiresRole: job.requires_role,
            lastStatus: metric?.lastStatus ?? null,
            lastRunAt: metric?.lastRunAt ?? null,
            consecutiveFailures: metric?.consecutiveFailures ?? 0,
        };
    });
}

export interface RunRef {
    runId: string;
    jobId: string;
    attempt: number;
    status: string;
    scheduledFor: Date | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    error: string | null;
}

interface RunRow {
    id: string;
    job_id: string;
    attempt: number;
    status: string;
    scheduled_for: Date | string | null;
    started_at: Date | string | null;
    finished_at: Date | string | null;
    error: string | null;
}

function _toRunRef(row: RunRow): RunRef {
    return {
        runId: row.id,
        jobId: row.job_id,
        attempt: row.attempt,
        status: row.status,
        scheduledFor: _toDate(row.scheduled_for),
        startedAt: _toDate(row.started_at),
        finishedAt: _toDate(row.finished_at),
        error: row.error,
    };
}

/** List dead runs (attempts exhausted), most recently finished first. */
export async function listDeadRuns(knex: Knex): Promise<RunRef[]> {
    const rows = await knex<RunRow>("sys_job_run")
        .where("status", "dead")
        .orderBy("finished_at", "desc")
        .select("*");
    return rows.map(_toRunRef);
}

export interface ListStuckRunsOptions {
    now?: () => Date;
    staleTimeoutMs?: number;
}

/**
 * List runs stuck in `running` whose started_at is older than the staleness
 * threshold — the rows the reaper would recover on its next tick. Useful for
 * surfacing crash-mid-run state before the reaper fires.
 */
export async function listStuckRuns(
    knex: Knex,
    options: ListStuckRunsOptions = {},
): Promise<RunRef[]> {
    const now = options.now ?? (() => new Date());
    const staleTimeoutMs = options.staleTimeoutMs ?? REAPER_STALE_TIMEOUT_MS;
    const cutoff = new Date(now().getTime() - staleTimeoutMs);

    const rows = await knex<RunRow>("sys_job_run")
        .where("status", "running")
        .where("started_at", "<=", cutoff)
        .orderBy("started_at", "asc")
        .select("*");
    return rows.map(_toRunRef);
}

// ── Controls ────────────────────────────────────────────────────────────────

/**
 * Set a job's enabled flag. Returns true if the job existed and was updated,
 * false if no job has that id.
 */
export async function setJobEnabled(knex: Knex, jobId: string, enabled: boolean): Promise<boolean> {
    const updated = await knex("sys_job").where({ id: jobId }).update({ enabled });
    return updated > 0;
}

export function enableJob(knex: Knex, jobId: string): Promise<boolean> {
    return setJobEnabled(knex, jobId, true);
}

export function disableJob(knex: Knex, jobId: string): Promise<boolean> {
    return setJobEnabled(knex, jobId, false);
}

export interface RunNowOptions {
    now?: () => Date;
}

/**
 * Enqueue an immediate pending run for a job (manual trigger). Inserts a fresh
 * attempt-1 run with scheduled_for = now so the next runner tick claims it.
 * Throws if the job does not exist.
 */
export async function runNow(
    knex: Knex,
    jobId: string,
    options: RunNowOptions = {},
): Promise<string> {
    const now = options.now ?? (() => new Date());
    const job = await knex("sys_job").where({ id: jobId }).first();
    if (job == null) {
        throw new Error(`runNow: no job with id "${jobId}"`);
    }

    const runId = crypto.randomUUID();
    await knex("sys_job_run").insert({
        id: runId,
        job_id: jobId,
        scheduled_for: now(),
        status: "pending",
        attempt: 1,
        claimed_by: null,
        started_at: null,
        finished_at: null,
        error: null,
    });
    return runId;
}

/**
 * Re-enqueue a dead run as a fresh attempt-1 pending run. The original dead row
 * is left intact as an audit record. Returns the new run id. Throws if the run
 * does not exist or is not in the `dead` state.
 */
export async function requeueRun(
    knex: Knex,
    runId: string,
    options: RunNowOptions = {},
): Promise<string> {
    const now = options.now ?? (() => new Date());
    const run = await knex("sys_job_run").where({ id: runId }).first();
    if (run == null) {
        throw new Error(`requeueRun: no run with id "${runId}"`);
    }
    if (run.status !== "dead") {
        throw new Error(
            `requeueRun: run "${runId}" is "${run.status}", not "dead"; only dead runs are requeued`,
        );
    }

    const newRunId = crypto.randomUUID();
    await knex("sys_job_run").insert({
        id: newRunId,
        job_id: run.job_id,
        scheduled_for: now(),
        status: "pending",
        attempt: 1,
        claimed_by: null,
        started_at: null,
        finished_at: null,
        error: null,
    });
    return newRunId;
}
