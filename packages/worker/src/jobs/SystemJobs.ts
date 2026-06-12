/**
 * TRN-159: Built-in system jobs wiring.
 *
 * The platform manages itself with its own primitive: the stale-run reaper and
 * history pruner are ordinary registered jobs (`sys.jobs.reap`, `sys.jobs.prune`)
 * scheduled like any other, gated on the `sys.scheduler` role so exactly one
 * elected process runs them. This is also an end-to-end smoke test of the whole
 * jobs/roles stack — scheduler → run row → runner → handler.
 *
 * Two steps, called from a worker's wiring:
 *   - registerSystemJobs(handlers, …) — register the handler implementations.
 *   - seedSystemJobs(knex, …)         — idempotently insert the sys_job rows so
 *                                       the scheduler starts producing runs.
 */

import type { Knex } from "knex";
import {
    PRUNER_SCHEDULE,
    REAPER_SCHEDULE,
    SYS_JOB_MAX_ATTEMPTS,
    SYS_JOB_PRUNER_ID,
    SYS_JOB_REAPER_ID,
    SYS_SCHEDULER_ROLE,
} from "../config.js";
import type { JobHandlers } from "../JobHandlers.js";
import type { Schedule } from "../schedule/types.js";
import { createHistoryPruner } from "./HistoryPruner.js";
import { createStaleRunReaper } from "./StaleRunReaper.js";

export interface SystemJobsOptions {
    /** Injectable clock, forwarded to the handlers and used for seed next_run_at. */
    now?: () => Date;
    /** Override the reaper staleness threshold. */
    staleTimeoutMs?: number;
    /** Override the pruner short-retention window. */
    succeededRetentionMs?: number;
    /** Override the pruner long-retention window. */
    deadRetentionMs?: number;
}

/**
 * Register the built-in system job handlers under their canonical ids. Call at
 * worker wiring time, before any runner tick. Handler clocks/thresholds are
 * forwarded so tests can stay deterministic.
 */
export function registerSystemJobs(handlers: JobHandlers, options: SystemJobsOptions = {}): void {
    handlers.registerJob(
        SYS_JOB_REAPER_ID,
        createStaleRunReaper({ now: options.now, staleTimeoutMs: options.staleTimeoutMs }),
    );
    handlers.registerJob(
        SYS_JOB_PRUNER_ID,
        createHistoryPruner({
            now: options.now,
            succeededRetentionMs: options.succeededRetentionMs,
            deadRetentionMs: options.deadRetentionMs,
        }),
    );
}

interface SystemJobSeed {
    id: string;
    schedule: Schedule;
}

const SYSTEM_JOB_SEEDS: SystemJobSeed[] = [
    { id: SYS_JOB_REAPER_ID, schedule: { every: REAPER_SCHEDULE } },
    { id: SYS_JOB_PRUNER_ID, schedule: { every: PRUNER_SCHEDULE } },
];

/**
 * Idempotently insert the built-in sys_job rows (reaper, pruner) on the
 * `sys.scheduler` role. Existing rows are left untouched so an operator's
 * enable/disable or schedule edits survive a restart. Uses one read + one batch
 * insert — no per-row query.
 */
export async function seedSystemJobs(knex: Knex, options: SystemJobsOptions = {}): Promise<void> {
    const now = options.now ?? (() => new Date());
    const ids = SYSTEM_JOB_SEEDS.map((s) => s.id);

    const existing = await knex("sys_job").whereIn("id", ids).select("id");
    const existingIds = new Set(existing.map((r: { id: string }) => r.id));

    const toInsert = SYSTEM_JOB_SEEDS.filter((seed) => !existingIds.has(seed.id)).map((seed) => ({
        id: seed.id,
        schedule: JSON.stringify(seed.schedule),
        // In-process handler id is the job id itself (registerSystemJobs).
        handler: seed.id,
        requires_role: SYS_SCHEDULER_ROLE,
        enabled: true,
        next_run_at: now(),
        max_attempts: SYS_JOB_MAX_ATTEMPTS,
        meta: null,
    }));

    if (toInsert.length > 0) {
        await knex("sys_job").insert(toInsert);
    }
}
