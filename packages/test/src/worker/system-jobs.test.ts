/**
 * TRN-159: Integration tests for the built-in system jobs wiring.
 *
 * Real SQLite (in-memory), real schema, real handler registry — no mocks.
 *
 * Covers:
 *   - seedSystemJobs creates the reaper + pruner jobs on the sys.scheduler role.
 *   - seeding is idempotent (safe to call every boot).
 *   - registerSystemJobs wires handlers that the registry resolves and that
 *     actually act (the reaper, run via its registered handler, reaps a stale
 *     run) — an end-to-end smoke through registry → handler → effect.
 */

import { createDataContext } from "@jasonscharf/data";
import {
    type JobContext,
    JobHandlers,
    registerSystemJobs,
    SYS_JOB_PRUNER_ID,
    SYS_JOB_REAPER_ID,
    SYS_SCHEDULER_ROLE,
    seedSystemJobs,
} from "@jasonscharf/worker";
import type { Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const NOW = new Date("2026-06-01T12:00:00.000Z");
const STALE_TIMEOUT_MS = 10 * 60 * 1_000;

describe("SystemJobs — SQLite (in-memory)", () => {
    let knex: Knex;

    beforeEach(async () => {
        knex = await createDataContext({ client: "sqlite", filename: ":memory:" });
    });

    afterEach(async () => {
        await knex.destroy();
    });

    it("seeds the reaper and pruner jobs on the sys.scheduler role", async () => {
        await seedSystemJobs(knex, { now: () => NOW });

        const jobs = await knex("sys_job").orderBy("id", "asc").select("*");
        const ids = jobs.map((j: { id: string }) => j.id);
        expect(ids).toContain(SYS_JOB_REAPER_ID);
        expect(ids).toContain(SYS_JOB_PRUNER_ID);

        const reaper = jobs.find((j: { id: string }) => j.id === SYS_JOB_REAPER_ID);
        expect(reaper.requires_role).toBe(SYS_SCHEDULER_ROLE);
        expect(reaper.handler).toBe(SYS_JOB_REAPER_ID);
        expect(reaper.enabled === true || reaper.enabled === 1).toBe(true);
        expect(JSON.parse(reaper.schedule)).toEqual({ every: "PT1M" });
    });

    it("is idempotent — seeding twice does not duplicate or throw", async () => {
        await seedSystemJobs(knex, { now: () => NOW });
        await seedSystemJobs(knex, { now: () => NOW });

        const count = await knex("sys_job").count<{ c: number }[]>({ c: "*" }).first();
        expect(Number(count?.c)).toBe(2);
    });

    it("registers handlers that the registry resolves and that act on stale runs", async () => {
        const handlers = new JobHandlers();
        registerSystemJobs(handlers, { now: () => NOW, staleTimeoutMs: STALE_TIMEOUT_MS });

        const reaper = handlers.lookup(SYS_JOB_REAPER_ID);
        const pruner = handlers.lookup(SYS_JOB_PRUNER_ID);
        expect(reaper).toBeDefined();
        expect(pruner).toBeDefined();

        // Seed a job + a stale running run, then run the *registered* reaper.
        await knex("sys_job").insert({
            id: "job.x",
            schedule: JSON.stringify({ every: "PT1M" }),
            handler: "noop",
            requires_role: null,
            enabled: true,
            next_run_at: NOW,
            max_attempts: 3,
            meta: null,
        });
        const staleRunId = crypto.randomUUID();
        await knex("sys_job_run").insert({
            id: staleRunId,
            job_id: "job.x",
            scheduled_for: NOW,
            status: "running",
            attempt: 1,
            claimed_by: "runner-dead",
            started_at: new Date(NOW.getTime() - STALE_TIMEOUT_MS - 1_000),
            finished_at: null,
            error: null,
        });

        await knex.transaction(async (trx) => {
            const ctx: JobContext = { knex, trx };
            // biome-ignore lint/style/noNonNullAssertion: asserted defined above.
            await reaper!(ctx, {});
        });

        const reaped = await knex("sys_job_run").where({ id: staleRunId }).first();
        expect(reaped.status).toBe("failed");
        expect(reaped.error).toMatch(/reaped/i);
        const all = await knex("sys_job_run").where({ job_id: "job.x" }).select("*");
        expect(all).toHaveLength(2); // original + enqueued retry
    });
});
