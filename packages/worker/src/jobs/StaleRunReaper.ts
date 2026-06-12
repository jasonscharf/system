/**
 * TRN-159: Stale-run reaper.
 *
 * A built-in system job (id `sys.jobs.reap`) that recovers `sys_job_run` rows
 * stuck in `running` because the executor crashed mid-run. It is the crash
 * counterpart to lease expiry on the role side: JobRunner marks a run `running`
 * before invoking the handler, so a process that dies mid-handler leaves the row
 * `running` forever with no one to finish it.
 *
 * A run is "stale" when its `started_at` is older than `staleTimeoutMs` — longer
 * than any handler is allowed to take (the per-handler timeout). The reaper
 * treats a stale run as a failed attempt, mirroring JobRunner's failure path:
 *   - attempts remaining  → mark the stale row `failed` and enqueue a fresh
 *     `pending` retry (attempt + 1, eligible immediately).
 *   - attempts exhausted  → mark the stale row `dead`.
 *
 * Incrementing the attempt across reaps is deliberate: a handler that crashes
 * the process every run must still reach `dead` rather than loop forever.
 *
 * Registered as a JobHandler so the platform manages itself with its own
 * primitive. The clock and stale threshold are injectable for deterministic
 * tests; production wires the real clock and REAPER_STALE_TIMEOUT_MS.
 */

import { REAPER_STALE_TIMEOUT_MS } from "../config.js";
import type { JobContext, JobHandler } from "../JobHandlers.js";

export interface StaleRunReaperOptions {
    /** Injectable clock for deterministic tests. Defaults to () => new Date(). */
    now?: () => Date;
    /**
     * A `running` run whose started_at is older than this is considered stale.
     * Defaults to REAPER_STALE_TIMEOUT_MS.
     */
    staleTimeoutMs?: number;
}

/** A stale `running` run joined to its parent job's attempt cap. */
interface StaleRun {
    id: string;
    job_id: string;
    attempt: number;
    max_attempts: number;
}

/**
 * Build the stale-run reaper handler.
 *
 * Register the result under SYS_JOB_REAPER_ID:
 *   handlers.registerJob(SYS_JOB_REAPER_ID, createStaleRunReaper({ ... }))
 */
export function createStaleRunReaper(options: StaleRunReaperOptions = {}): JobHandler {
    const now = options.now ?? (() => new Date());
    const staleTimeoutMs = options.staleTimeoutMs ?? REAPER_STALE_TIMEOUT_MS;

    return async (ctx: JobContext, _args: Record<string, string>): Promise<void> => {
        const reapedAt = now();
        const cutoff = new Date(reapedAt.getTime() - staleTimeoutMs);
        const trx = ctx.trx;

        const stale = await trx("sys_job_run as r")
            .join("sys_job as j", "r.job_id", "j.id")
            .where("r.status", "running")
            .where("r.started_at", "<=", cutoff)
            .select<StaleRun[]>(
                "r.id as id",
                "r.job_id as job_id",
                "r.attempt as attempt",
                "j.max_attempts as max_attempts",
            );

        for (const run of stale) {
            const hasRetry = run.attempt < run.max_attempts;
            const error =
                `reaped: run was stale (running with no progress for over ${staleTimeoutMs}ms); ` +
                "the executor likely crashed mid-run";

            await trx("sys_job_run")
                .where({ id: run.id })
                .update({
                    status: hasRetry ? "failed" : "dead",
                    finished_at: reapedAt,
                    error,
                });

            if (hasRetry) {
                // Re-enqueue immediately: a crash is not a logic failure, so no
                // backoff. Eligibility is gated by scheduled_for <= now.
                await trx("sys_job_run").insert({
                    id: crypto.randomUUID(),
                    job_id: run.job_id,
                    scheduled_for: reapedAt,
                    status: "pending",
                    attempt: run.attempt + 1,
                    claimed_by: null,
                    started_at: null,
                    finished_at: null,
                    error: null,
                });
            }
        }
    };
}
