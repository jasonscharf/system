/**
 * TRN-159: History retention pruner.
 *
 * A built-in system job (id `sys.jobs.prune`) that keeps `sys_job_run` bounded
 * by deleting terminal rows past their retention window:
 *   - `succeeded` / `failed` rows older than `succeededRetentionMs` — the
 *     recent-success and superseded-attempt audit trail, kept briefly.
 *   - `dead` rows older than `deadRetentionMs` — kept longer to aid post-mortem
 *     diagnosis of jobs that exhausted their attempts.
 *
 * Live rows (`pending`, `running`) are never pruned regardless of age — a
 * long-scheduled future run must survive. `failed` rows are intermediate
 * attempts that have already been superseded by a retry run, so they share the
 * short retention window with `succeeded`.
 *
 * Registered as a JobHandler. Clock and retention windows are injectable for
 * deterministic tests; production wires the real clock and the PRUNER_* config.
 */

import { PRUNER_DEAD_RETENTION_MS, PRUNER_SUCCEEDED_RETENTION_MS } from "../config.js";
import type { JobContext, JobHandler } from "../JobHandlers.js";

export interface HistoryPrunerOptions {
    /** Injectable clock for deterministic tests. Defaults to () => new Date(). */
    now?: () => Date;
    /**
     * `succeeded`/`failed` rows with finished_at older than this are deleted.
     * Defaults to PRUNER_SUCCEEDED_RETENTION_MS.
     */
    succeededRetentionMs?: number;
    /**
     * `dead` rows with finished_at older than this are deleted.
     * Defaults to PRUNER_DEAD_RETENTION_MS.
     */
    deadRetentionMs?: number;
}

/**
 * Build the history-pruner handler.
 *
 * Register the result under SYS_JOB_PRUNER_ID:
 *   handlers.registerJob(SYS_JOB_PRUNER_ID, createHistoryPruner({ ... }))
 */
export function createHistoryPruner(options: HistoryPrunerOptions = {}): JobHandler {
    const now = options.now ?? (() => new Date());
    const succeededRetentionMs = options.succeededRetentionMs ?? PRUNER_SUCCEEDED_RETENTION_MS;
    const deadRetentionMs = options.deadRetentionMs ?? PRUNER_DEAD_RETENTION_MS;

    return async (ctx: JobContext, _args: Record<string, string>): Promise<void> => {
        const prunedAt = now();
        const shortCutoff = new Date(prunedAt.getTime() - succeededRetentionMs);
        const longCutoff = new Date(prunedAt.getTime() - deadRetentionMs);
        const trx = ctx.trx;

        // Short-retention terminal states: succeeded runs and superseded failed
        // attempts.
        await trx("sys_job_run")
            .whereIn("status", ["succeeded", "failed"])
            .where("finished_at", "<=", shortCutoff)
            .del();

        // Dead rows are retained longer for diagnosis.
        await trx("sys_job_run")
            .where("status", "dead")
            .where("finished_at", "<=", longCutoff)
            .del();
    };
}
