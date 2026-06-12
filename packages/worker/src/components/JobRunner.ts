/**
 * TRN-157: JobRunner FlowComponent.
 *
 * Claims `pending` sys_job_run rows, resolves + executes each job's handler,
 * and records the outcome with retry / backoff / dead-letter semantics.
 *
 * N runners across processes drain the queue concurrently via FOR UPDATE SKIP
 * LOCKED (Postgres) or serialised SQLite writes.
 *
 * Claim tick:
 *   1. SELECT pending sys_job_run rows with scheduled_for <= now, oldest first,
 *      joined to sys_job to read requires_role, handler, max_attempts.
 *      — FOR UPDATE SKIP LOCKED on Postgres; plain SELECT on SQLite.
 *   2. Within one transaction, mark claimable rows running + set claimed_by
 *      + started_at.
 *      — requires_role gating: only claim runs whose job requires_role is null
 *        OR holdsRole(requires_role) is true; leave the rest pending.
 *
 * Execute:
 *   - Resolve the handler (module:// URI → resolveModuleRef; otherwise look up
 *     in the in-process registry).
 *   - Run the handler inside a fresh handler-scoped transaction so a failure
 *     rolls back the handler's own DB work but NOT the run-status bookkeeping.
 *   - Enforce timeoutMs via Promise.race so wedged handlers cannot hang the runner.
 *   - Success → status='succeeded', finished_at=now.
 *   - Failure (throw/timeout) → record error; if attempt < max_attempts, insert
 *     a NEW retry run (status='pending', attempt+1, scheduled_for=now+backoff)
 *     and mark the current run failed; else mark it dead.
 *
 * Injection points for deterministic tests:
 *   - now: () => Date           — injectable clock
 *   - holdsRole: (role) => bool — injectable role predicate (default: () => true)
 *   - tickIntervalMs            — override tick cadence
 */

import { resolveModuleRef } from "@jasonscharf/core";
import { FlowComponent, type FlowComponentOptions } from "@jasonscharf/flow";
import type { Knex } from "knex";
import {
    RUNNER_BACKOFF_BASE_MS,
    RUNNER_BACKOFF_MAX_MS,
    RUNNER_BATCH_SIZE,
    RUNNER_HANDLER_TIMEOUT_MS,
    RUNNER_TICK_INTERVAL_MS,
} from "../config.js";
import type { JobContext, JobHandler, JobHandlers } from "../JobHandlers.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/** A pending sys_job_run row joined to its parent sys_job. */
interface ClaimCandidate {
    run_id: string;
    job_id: string;
    scheduled_for: Date | string;
    attempt: number;
    handler: string;
    requires_role: string | null;
    max_attempts: number;
}

export interface JobRunnerOptions extends FlowComponentOptions {
    knex: Knex;
    handlers: JobHandlers;
    /**
     * Injectable clock for deterministic tests. Defaults to () => new Date().
     */
    now?: () => Date;
    /**
     * Returns true when this process holds the given role.
     * Wire this to roleManager.holds(role) in the app. JobRunner never imports
     * or references RoleManager directly.
     * Defaults to () => true (no role gating).
     */
    holdsRole?: (role: string) => boolean;
    /** Per-handler execution timeout in ms. Defaults to RUNNER_HANDLER_TIMEOUT_MS. */
    timeoutMs?: number;
    /** Maximum runs claimed per tick. Defaults to RUNNER_BATCH_SIZE. */
    batchSize?: number;
    /** Maximum backoff cap in ms. Defaults to RUNNER_BACKOFF_MAX_MS. */
    backoffMaxMs?: number;
    /** Tick interval in ms. Defaults to RUNNER_TICK_INTERVAL_MS. */
    tickIntervalMs?: number;
}

// ── JobRunner ─────────────────────────────────────────────────────────────────

/**
 * FlowComponent that claims pending sys_job_run rows, executes their handlers,
 * and records the outcome with retry and dead-letter semantics.
 */
export class JobRunner extends FlowComponent {
    private readonly _knex: Knex;
    private readonly _handlers: JobHandlers;
    private readonly _now: () => Date;
    private readonly _holdsRole: (role: string) => boolean;
    private readonly _timeoutMs: number;
    private readonly _batchSize: number;
    private readonly _backoffMaxMs: number;
    private readonly _tickIntervalMs: number;
    private _timer: ReturnType<typeof setInterval> | undefined;

    constructor(options: JobRunnerOptions) {
        super(options);

        this._knex = options.knex;
        this._handlers = options.handlers;
        this._now = options.now ?? (() => new Date());
        this._holdsRole = options.holdsRole ?? (() => true);
        this._timeoutMs = options.timeoutMs ?? RUNNER_HANDLER_TIMEOUT_MS;
        this._batchSize = options.batchSize ?? RUNNER_BATCH_SIZE;
        this._backoffMaxMs = options.backoffMaxMs ?? RUNNER_BACKOFF_MAX_MS;
        this._tickIntervalMs = options.tickIntervalMs ?? RUNNER_TICK_INTERVAL_MS;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    protected override async onInit(): Promise<void> {
        // Run one tick immediately so the runner acts without waiting for the
        // first interval.
        await this._tick();

        this._timer = setInterval(() => {
            const tickPromise = this._tick();
            tickPromise.catch((err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`[JobRunner] tick error: ${msg}`);
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
     * One runner tick. Exposed for direct invocation in tests (without going
     * through onInit and starting the background timer).
     */
    async _tick(): Promise<void> {
        const now = this._now();
        const claimed = await this._claim(now);

        for (const run of claimed) {
            await this._execute(run, now);
        }
    }

    // ── Claim ─────────────────────────────────────────────────────────────────

    /**
     * Select and claim pending runs in one transaction.
     *
     * On Postgres: FOR UPDATE SKIP LOCKED ensures concurrent runners never
     * double-claim. On SQLite: serialised writers make a plain SELECT safe.
     *
     * requires_role gating is applied in-process after fetching candidates:
     * runs whose job requires a role this process does not hold are left
     * untouched (status stays pending) so the holding process can claim them.
     */
    private async _claim(now: Date): Promise<ClaimCandidate[]> {
        const isPg = _isPgClient(this._knex);
        const runnerId = _runnerId();
        const claimed: ClaimCandidate[] = [];

        await this._knex.transaction(async (trx) => {
            let query = trx("sys_job_run as r")
                .join("sys_job as j", "r.job_id", "j.id")
                .select<ClaimCandidate[]>(
                    "r.id as run_id",
                    "r.job_id",
                    "r.scheduled_for",
                    "r.attempt",
                    "j.handler",
                    "j.requires_role",
                    "j.max_attempts",
                )
                .where("r.status", "pending")
                .where("r.scheduled_for", "<=", now)
                .orderBy("r.scheduled_for", "asc")
                .limit(this._batchSize);

            if (isPg) {
                query = query.forUpdate("r").skipLocked();
            }

            const candidates = await query;

            for (const candidate of candidates) {
                // Gate on role: leave untouched if this runner does not hold
                // the required role. Another runner (the holder) will claim it.
                if (candidate.requires_role !== null && !this._holdsRole(candidate.requires_role)) {
                    continue;
                }

                await trx("sys_job_run").where({ id: candidate.run_id }).update({
                    status: "running",
                    claimed_by: runnerId,
                    started_at: now,
                });

                claimed.push(candidate);
            }
        });

        return claimed;
    }

    // ── Execute ───────────────────────────────────────────────────────────────

    /**
     * Execute one claimed run.
     *
     * Resolves the handler reference, runs it inside a fresh handler-scoped
     * transaction with a timeout guard, and records the outcome.
     */
    private async _execute(run: ClaimCandidate, claimedAt: Date): Promise<void> {
        let handlerFn: JobHandler;
        let handlerArgs: Record<string, string>;

        try {
            ({ fn: handlerFn, args: handlerArgs } = await this._resolveHandler(run.handler));
        } catch (resolveErr) {
            const errorMsg = resolveErr instanceof Error ? resolveErr.message : String(resolveErr);
            await this._recordFailure(run, claimedAt, errorMsg);
            return;
        }

        let handlerError: string | undefined;

        try {
            await this._knex.transaction(async (handlerTrx) => {
                const ctx: JobContext = { knex: this._knex, trx: handlerTrx };

                const timeoutPromise = new Promise<never>((_, reject) => {
                    setTimeout(() => {
                        reject(
                            new Error(
                                `JobRunner: handler "${run.handler}" timed out after ${this._timeoutMs}ms`,
                            ),
                        );
                    }, this._timeoutMs);
                });

                await Promise.race([handlerFn(ctx, handlerArgs), timeoutPromise]);
            });
        } catch (err) {
            handlerError = err instanceof Error ? err.message : String(err);
        }

        const finishedAt = this._now();

        if (handlerError === undefined) {
            await this._recordSuccess(run, finishedAt);
        } else {
            await this._recordFailure(run, finishedAt, handlerError);
        }
    }

    // ── Handler resolution ────────────────────────────────────────────────────

    /**
     * Resolve the handler string to a callable + args pair.
     *
     * If the string starts with `module://` it is forwarded to resolveModuleRef.
     * Otherwise it is treated as an in-process registered id and looked up in
     * the handler registry. Throws a descriptive error if neither resolves.
     */
    private async _resolveHandler(
        handlerRef: string,
    ): Promise<{ fn: JobHandler; args: Record<string, string> }> {
        if (handlerRef.startsWith("module://")) {
            const resolved = await resolveModuleRef(handlerRef);
            return {
                fn: resolved.fn as JobHandler,
                args: resolved.args,
            };
        }

        const registered = this._handlers.lookup(handlerRef);
        if (registered === undefined) {
            throw new Error(
                `JobRunner: no handler registered for "${handlerRef}". ` +
                    `Register one via handlers.registerJob("${handlerRef}", fn) ` +
                    `or use a module:// URI.`,
            );
        }

        return { fn: registered, args: {} };
    }

    // ── Outcome recording ─────────────────────────────────────────────────────

    private async _recordSuccess(run: ClaimCandidate, finishedAt: Date): Promise<void> {
        await this._knex("sys_job_run").where({ id: run.run_id }).update({
            status: "succeeded",
            finished_at: finishedAt,
            error: null,
        });
    }

    /**
     * Record a handler failure.
     *
     * If the run has remaining attempts: mark it `failed` and insert a new
     * retry run with capped exponential backoff.
     * If this was the final attempt: mark it `dead`.
     */
    private async _recordFailure(
        run: ClaimCandidate,
        finishedAt: Date,
        error: string,
    ): Promise<void> {
        const hasRetry = run.attempt < run.max_attempts;

        await this._knex.transaction(async (trx) => {
            await trx("sys_job_run")
                .where({ id: run.run_id })
                .update({
                    status: hasRetry ? "failed" : "dead",
                    finished_at: finishedAt,
                    error,
                });

            if (hasRetry) {
                const backoffMs = _computeBackoff(
                    run.attempt,
                    RUNNER_BACKOFF_BASE_MS,
                    this._backoffMaxMs,
                );
                // scheduled_for for the retry run is the retry-eligible time,
                // not the original scheduled_for. The runner's claim scan uses
                // scheduled_for <= now to gate eligibility.
                const retryAt = new Date(finishedAt.getTime() + backoffMs);

                await trx("sys_job_run").insert({
                    id: crypto.randomUUID(),
                    job_id: run.job_id,
                    scheduled_for: retryAt,
                    status: "pending",
                    attempt: run.attempt + 1,
                    claimed_by: null,
                    started_at: null,
                    finished_at: null,
                    error: null,
                });
            }
        });
    }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Detect whether the Knex instance is connected to Postgres.
 * Mirrors the isPg check used in JobScheduler and migration 003.
 */
function _isPgClient(knex: Knex): boolean {
    const client = (knex.client as { config: { client: string } }).config.client;
    return client === "pg" || client === "postgresql";
}

/**
 * Capped exponential backoff.
 *
 * attempt 1 → base * 2^0 = base
 * attempt 2 → base * 2^1 = 2*base
 * …
 * capped at maxMs.
 */
function _computeBackoff(attempt: number, baseMs: number, maxMs: number): number {
    const raw = baseMs * 2 ** (attempt - 1);
    return Math.min(raw, maxMs);
}

/** Normalise a date value that may arrive as a string from SQLite. */
function _toDate(value: Date | string): Date {
    if (value instanceof Date) {
        return value;
    }
    return new Date(value);
}

/**
 * Stable runner identifier for the `claimed_by` column.
 *
 * Built once per module load (i.e. once per process). Using the process PID
 * + a fixed startup timestamp keeps it unique across restarts without requiring
 * a DB round trip.
 */
const _RUNNER_ID = `runner-${process.pid}-${Date.now()}`;

function _runnerId(): string {
    return _RUNNER_ID;
}
