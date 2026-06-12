/**
 * TRN-156: JobScheduler FlowComponent.
 *
 * Runs the due-job tick only while the injected isActive() predicate is true
 * (wired externally to a RoleManager.holds() check by the app). Idle (no DB
 * work) when isActive() is false, so multiple replicas do not race.
 *
 * Tick logic:
 *   1. SELECT due jobs WHERE enabled AND next_run_at <= now
 *      — FOR UPDATE SKIP LOCKED on Postgres; plain SELECT on SQLite
 *        (SQLite serialises writers so locking is implicit).
 *   2. For each due job, in one transaction:
 *      a. INSERT a sys_job_run row (status=pending, attempt=1).
 *      b. UPDATE sys_job.next_run_at = nextRun(schedule, now).
 *   3. The UNIQUE (job_id, scheduled_for, attempt) constraint makes a racing
 *      second scheduler a harmless no-op — unique violations are caught and
 *      silently ignored.
 *
 * Catch-up policy:
 *   If the process was down and next_run_at is far in the past, we fold all
 *   missed fires into ONE catch-up run. next_run_at is advanced by computing
 *   nextRun(schedule, now) from NOW, not by replaying every missed slot.
 *
 * Injection points for deterministic tests:
 *   - isActive: () => boolean   — controls whether each tick does work
 *   - now: () => Date            — injectable clock
 *   - tickIntervalMs             — override tick cadence
 */

import { FlowComponent, type FlowComponentOptions } from "@jasonscharf/flow";
import type { Knex } from "knex";
import { SCHEDULER_BATCH_SIZE, SCHEDULER_TICK_INTERVAL_MS } from "../config.js";
import { nextRun } from "../schedule/nextRun.js";
import type { Schedule } from "../schedule/types.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/** A row from sys_job as read by the scheduler tick. */
interface DueJob {
    id: string;
    schedule: unknown;
    next_run_at: Date | string;
}

export interface JobSchedulerOptions extends FlowComponentOptions {
    knex: Knex;
    /**
     * Returns true when this process should perform the scheduler tick.
     * Wire this to roleManager.holds(schedulerRole) in the app. JobScheduler
     * never imports or references RoleManager directly.
     */
    isActive: () => boolean;
    /** Injectable clock for deterministic tests. Defaults to () => new Date(). */
    now?: () => Date;
    /** Tick interval in ms. Defaults to SCHEDULER_TICK_INTERVAL_MS. */
    tickIntervalMs?: number;
}

// ── JobScheduler ──────────────────────────────────────────────────────────────

/**
 * FlowComponent that scans sys_job for due jobs and enqueues sys_job_run rows.
 *
 * The component does NOT execute jobs — that is the JobRunner's responsibility.
 * Its sole job is to advance the clock-driven schedule and produce pending runs.
 */
export class JobScheduler extends FlowComponent {
    private readonly _knex: Knex;
    private readonly _isActive: () => boolean;
    private readonly _now: () => Date;
    private readonly _tickIntervalMs: number;
    private _timer: ReturnType<typeof setInterval> | undefined;

    constructor(options: JobSchedulerOptions) {
        super(options);

        this._knex = options.knex;
        this._isActive = options.isActive;
        this._now = options.now ?? (() => new Date());
        this._tickIntervalMs = options.tickIntervalMs ?? SCHEDULER_TICK_INTERVAL_MS;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    protected override async onInit(): Promise<void> {
        // Run one tick immediately so the scheduler acts without waiting for
        // the first interval.
        await this._tick();

        this._timer = setInterval(() => {
            const tickPromise = this._tick();
            tickPromise.catch((err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`[JobScheduler] tick error: ${msg}`);
            });
        }, this._tickIntervalMs);
    }

    protected override async onDispose(): Promise<void> {
        if (this._timer !== undefined) {
            clearInterval(this._timer);
            this._timer = undefined;
        }
    }

    // ── Tick ──────────────────────────────────────────────────────────────────

    /**
     * One scheduler tick. Exposed for direct invocation in tests (without
     * going through onInit and starting the background timer).
     */
    async _tick(): Promise<void> {
        if (!this._isActive()) {
            return;
        }

        const now = this._now();
        const dueJobs = await this._selectDueJobs(now);

        for (const job of dueJobs) {
            await this._processJob(job, now);
        }
    }

    // ── Due-job select ────────────────────────────────────────────────────────

    /**
     * Select due jobs whose next_run_at is at or before `now`.
     *
     * Portability: FOR UPDATE SKIP LOCKED is Postgres-only. On SQLite we omit
     * the locking clause — SQLite serialises all writers on one connection, so
     * a plain SELECT followed by an UPDATE in one transaction is safe.
     */
    private async _selectDueJobs(now: Date): Promise<DueJob[]> {
        const isPg = _isPgClient(this._knex);

        let query = this._knex("sys_job")
            .select<DueJob[]>("id", "schedule", "next_run_at")
            .where("enabled", true)
            .where("next_run_at", "<=", now)
            .orderBy("next_run_at", "asc")
            .limit(SCHEDULER_BATCH_SIZE);

        if (isPg) {
            query = query.forUpdate().skipLocked();
        }

        return query;
    }

    // ── Job processing ────────────────────────────────────────────────────────

    /**
     * Process one due job inside a single transaction:
     *   1. Insert a pending sys_job_run row.
     *   2. Advance sys_job.next_run_at = nextRun(schedule, now).
     *
     * A UNIQUE conflict on (job_id, scheduled_for, attempt) means a racing
     * second scheduler already handled this fire — silently ignore it.
     *
     * Catch-up policy: next_run_at is advanced from NOW, not from the stale
     * next_run_at value, so a backlog of missed fires folds into one run.
     */
    private async _processJob(job: DueJob, now: Date): Promise<void> {
        const schedule = _parseSchedule(job.id, job.schedule);
        // next_run_at may arrive as a string from SQLite — normalise to Date.
        const scheduledFor = _toDate(job.next_run_at);
        const nextRunAt = nextRun(schedule, now);
        const runId = crypto.randomUUID();

        try {
            await this._knex.transaction(async (trx) => {
                await trx("sys_job_run").insert({
                    id: runId,
                    job_id: job.id,
                    scheduled_for: scheduledFor,
                    status: "pending",
                    attempt: 1,
                    claimed_by: null,
                    started_at: null,
                    finished_at: null,
                    error: null,
                });

                await trx("sys_job").where({ id: job.id }).update({
                    next_run_at: nextRunAt,
                });
            });
        } catch (err) {
            if (_isUniqueViolation(err)) {
                // Racing scheduler already handled this fire — harmless no-op.
                return;
            }
            throw err;
        }
    }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Detect whether the Knex instance is connected to Postgres.
 * Mirrors the isPg check used in migration 003.
 */
function _isPgClient(knex: Knex): boolean {
    const client = (knex.client as { config: { client: string } }).config.client;
    return client === "pg" || client === "postgresql";
}

/**
 * Parse the jsonb schedule field into a typed Schedule.
 * Throws if the value is not a valid object.
 */
function _parseSchedule(jobId: string, raw: unknown): Schedule {
    if (typeof raw === "string") {
        try {
            return JSON.parse(raw) as Schedule;
        } catch {
            throw new Error(`JobScheduler: job "${jobId}" has an unparseable schedule: ${raw}`);
        }
    }

    if (typeof raw !== "object" || raw === null) {
        throw new Error(
            `JobScheduler: job "${jobId}" schedule must be an object, got ${typeof raw}`,
        );
    }

    return raw as Schedule;
}

/** Normalise a date value that may arrive as a string from SQLite. */
function _toDate(value: Date | string): Date {
    if (value instanceof Date) {
        return value;
    }
    return new Date(value);
}

/**
 * Return true for a UNIQUE constraint violation from either Postgres or SQLite.
 *
 * Postgres: error code '23505' (unique_violation).
 * SQLite:   error message contains 'UNIQUE constraint failed'.
 */
function _isUniqueViolation(err: unknown): boolean {
    if (!(err instanceof Error)) {
        return false;
    }

    // Postgres driver exposes code on the error object.
    const pgCode = (err as Error & { code?: string }).code;
    if (pgCode === "23505") {
        return true;
    }

    // SQLite driver includes the constraint name in the message.
    return err.message.includes("UNIQUE constraint failed");
}
