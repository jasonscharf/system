/**
 * Fixture module for JobRunner module:// handler tests.
 *
 * Exports a minimal JobHandler that records what args it received so the test
 * can assert on them. The record is module-level so tests can inspect it.
 */

import type { JobContext } from "@jasonscharf/worker";

/** Captured invocations — reset between tests. */
export const invocations: Array<{ args: Record<string, string> }> = [];

/**
 * A no-op job handler that records its invocation args.
 * Addressable via a module:// URI pointing to this file with #handleNoopJob.
 */
export async function handleNoopJob(_ctx: JobContext, args: Record<string, string>): Promise<void> {
    invocations.push({ args: { ...args } });
}
