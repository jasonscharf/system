/**
 * Fixture module for JobRunner's pool-deadlock regression test (TRN-403).
 *
 * Exports a JobHandler addressable via a `module://` URI that, mid-run, acquires
 * ANOTHER connection from the same knex pool to do its own DB work (mirroring the
 * Switchyard Clock handler, which writes through a separate store after a network
 * call). If the JobRunner held an outer transaction around the handler on a
 * single-connection pool, this nested query could never get a connection and the
 * handler would hang until the runner's timeout. With the fix (a module:// handler
 * runs with no outer transaction) it completes.
 *
 * The knex handle is injected by the test via setPoolHandlerKnex so the fixture
 * stays a real, separately-resolved module (resolveModuleRef loads it fresh).
 */

import type { JobContext } from "@jasonscharf/worker";
import type { Knex } from "knex";

/** Captured invocations so the test can assert the handler actually ran. */
export const poolInvocations: Array<{ value: number }> = [];

let _knex: Knex | null = null;

/** Inject the knex handle the handler reaches a second connection through. */
export function setPoolHandlerKnex(knex: Knex | null): void {
    _knex = knex;
}

/**
 * A handler that does its OWN pooled DB work mid-run. It deliberately reads
 * through the shared pool (NOT through `ctx.trx`), so on a single-connection pool
 * it can only succeed if the runner is not already holding that one connection in
 * an outer transaction.
 */
export async function handlePoolJob(
    _ctx: JobContext,
    _args: Record<string, string>,
): Promise<void> {
    if (_knex === null) {
        throw new Error("pool-handler: knex not injected (call setPoolHandlerKnex first)");
    }
    const row = await _knex.raw("select 42 as value");
    // pg returns { rows }, sqlite returns an array; read the value defensively.
    const value =
        (row?.rows?.[0]?.value as number | undefined) ??
        (Array.isArray(row) ? (row[0]?.value as number | undefined) : undefined) ??
        42;
    poolInvocations.push({ value });
}
