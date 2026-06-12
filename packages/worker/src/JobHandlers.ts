/**
 * TRN-157: In-process job handler registry.
 *
 * Provides:
 *   - JobContext  — minimal context threaded into every handler call.
 *   - JobHandler  — the handler signature: (ctx, args) => Promise<void>.
 *   - JobHandlers — a simple registry of id → handler mappings.
 *
 * Resolution of a job's `handler` string happens in JobRunner:
 *   - `module://…` URIs are forwarded to resolveModuleRef (from @jasonscharf/core).
 *   - All other strings are looked up here (in-process registered handlers).
 */

import type { Knex } from "knex";

// ── JobContext ────────────────────────────────────────────────────────────────

/**
 * Minimal context threaded into every job handler invocation.
 *
 * Full wiring to ApplicationContext / logger is deferred to a later ticket
 * (TRN-158 / TRN-159). For now, handlers receive the knex instance and the
 * active transaction so they can perform database work atomically with their
 * own book-keeping.
 *
 * IMPORTANT: `trx` is a fresh handler-scoped transaction opened by JobRunner.
 * A handler failure rolls back `trx` but does NOT roll back the run-status
 * update (which lives in a separate outer transaction).
 */
export interface JobContext {
    /** The knex instance for the current data store. */
    readonly knex: Knex;
    /** The active handler-scoped transaction. Roll back on handler failure. */
    readonly trx: Knex.Transaction;
}

// ── JobHandler ────────────────────────────────────────────────────────────────

/**
 * The signature every registered (or module-resolved) job handler must satisfy.
 *
 * @param ctx  Handler context carrying the store connection and transaction.
 * @param args Bind-time argument bag from the `module://` URI query string,
 *             or an empty object for in-process registered handlers.
 */
export type JobHandler = (ctx: JobContext, args: Record<string, string>) => Promise<void>;

// ── JobHandlers registry ──────────────────────────────────────────────────────

/**
 * In-process registry mapping handler ids to callable JobHandler functions.
 *
 * Instances are created once per process and shared across all JobRunner
 * instances. Workers register their first-party handlers at startup via
 * `registerJob(id, handler)` before any runner tick fires.
 */
export class JobHandlers {
    private readonly _handlers = new Map<string, JobHandler>();

    /**
     * Register an in-process handler for the given id.
     *
     * The id is an arbitrary string that must match `sys_job.handler` for the
     * jobs that should use this handler. Any printable string is valid; by
     * convention use a dotted namespace like `labs.lifecycle.sweep`.
     *
     * Registering the same id twice overwrites the previous handler.
     */
    registerJob(id: string, handler: JobHandler): void {
        this._handlers.set(id, handler);
    }

    /**
     * Look up a registered handler by id.
     *
     * Returns `undefined` when no handler is registered for the given id.
     * The caller (JobRunner) is responsible for throwing a descriptive error
     * if the lookup fails and there is no module:// fallback.
     */
    lookup(id: string): JobHandler | undefined {
        return this._handlers.get(id);
    }
}
