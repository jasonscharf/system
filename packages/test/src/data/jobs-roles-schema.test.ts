/**
 * TRN-154: Integration tests for the Jobs & Roles control-plane schema.
 *
 * Verifies:
 *   - All three tables (sys_role_lease, sys_job, sys_job_run) are created by
 *     the migration.
 *   - A basic insert into each table succeeds.
 *   - The unique(job_id, scheduled_for, attempt) constraint on sys_job_run
 *     rejects a duplicate row.
 *
 * Runs against SQLite (in-memory, always) and Postgres (when SYS_PG_URL is set).
 * Each suite rolls back its transaction so the schema stays clean.
 */

import { createDataContext } from "@jasonscharf/data";
import type { Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ── Provider matrix ───────────────────────────────────────────────────────────

interface Provider {
    name: string;
    create(): Promise<Knex>;
}

const providers: Provider[] = [
    {
        name: "SQLite (in-memory)",
        create: () => createDataContext({ client: "sqlite", filename: ":memory:" }),
    },
];

if (process.env.SYS_PG_URL) {
    const url = new URL(process.env.SYS_PG_URL);
    providers.push({
        name: "Postgres",
        create: () =>
            createDataContext({
                client: "pg",
                host: url.hostname,
                port: url.port ? Number(url.port) : 5432,
                database: url.pathname.slice(1),
                user: url.username,
                password: url.password,
            }),
    });
}

// ── Shared suite ──────────────────────────────────────────────────────────────

for (const provider of providers) {
    describe(`Jobs & Roles schema — ${provider.name}`, () => {
        let knex: Knex;
        let trx: Knex.Transaction;

        beforeEach(async () => {
            knex = await provider.create();
            trx = await knex.transaction();
        });

        afterEach(async () => {
            await trx.rollback();
            await knex.destroy();
        });

        // ── Table existence ───────────────────────────────────────────────────
        // Verified by selecting from each table via the open transaction.
        // knex.schema.hasTable() would deadlock on SQLite (single-connection pool
        // with an open transaction), so we probe via a count query instead.

        it("sys_role_lease table exists", async () => {
            const [row] = await trx("sys_role_lease").count("* as n");
            expect(Number(row.n)).toBeGreaterThanOrEqual(0);
        });

        it("sys_job table exists", async () => {
            const [row] = await trx("sys_job").count("* as n");
            expect(Number(row.n)).toBeGreaterThanOrEqual(0);
        });

        it("sys_job_run table exists", async () => {
            const [row] = await trx("sys_job_run").count("* as n");
            expect(Number(row.n)).toBeGreaterThanOrEqual(0);
        });

        // ── Basic inserts ─────────────────────────────────────────────────────

        it("inserts a row into sys_role_lease", async () => {
            await trx("sys_role_lease").insert({
                role: "labs.lifecycle",
                slot: 0,
                holder_id: "worker-abc",
                acquired_at: new Date(),
                expires_at: new Date(Date.now() + 30_000),
                meta: null,
            });
            const rows = await trx("sys_role_lease").where({ role: "labs.lifecycle" }).select("*");
            expect(rows).toHaveLength(1);
            expect(rows[0].holder_id).toBe("worker-abc");
        });

        it("inserts a row into sys_job", async () => {
            await trx("sys_job").insert({
                id: "labs.lifecycle.sweep",
                schedule: JSON.stringify({ every: "PT30S" }),
                handler: "module://@jasonscharf/worker/LifecycleHandler.js#sweep",
                requires_role: "labs.lifecycle",
                enabled: true,
                next_run_at: new Date(Date.now() + 30_000),
                max_attempts: 3,
                meta: null,
            });
            const rows = await trx("sys_job").where({ id: "labs.lifecycle.sweep" }).select("*");
            expect(rows).toHaveLength(1);
            expect(rows[0].handler).toBe("module://@jasonscharf/worker/LifecycleHandler.js#sweep");
        });

        it("inserts a row into sys_job_run", async () => {
            await trx("sys_job").insert({
                id: "test.job",
                schedule: JSON.stringify({ every: "PT1M" }),
                handler: "module://@jasonscharf/worker/TestHandler.js#run",
                requires_role: null,
                enabled: true,
                next_run_at: new Date(Date.now() + 60_000),
                max_attempts: 1,
                meta: null,
            });
            const scheduledFor = new Date("2026-01-01T00:00:00Z");
            await trx("sys_job_run").insert({
                id: "00000000-0000-0000-0000-000000000001",
                job_id: "test.job",
                scheduled_for: scheduledFor,
                status: "pending",
                attempt: 1,
                claimed_by: null,
                started_at: null,
                finished_at: null,
                error: null,
            });
            const rows = await trx("sys_job_run").where({ job_id: "test.job" }).select("*");
            expect(rows).toHaveLength(1);
            expect(rows[0].status).toBe("pending");
        });

        // ── Constraint: unique(job_id, scheduled_for, attempt) ────────────────

        it("rejects a duplicate (job_id, scheduled_for, attempt) in sys_job_run", async () => {
            await trx("sys_job").insert({
                id: "dedup.job",
                schedule: JSON.stringify({ every: "PT5M" }),
                handler: "module://@jasonscharf/worker/DedupHandler.js#run",
                requires_role: null,
                enabled: true,
                next_run_at: new Date(Date.now() + 300_000),
                max_attempts: 1,
                meta: null,
            });

            const scheduledFor = new Date("2026-06-01T12:00:00Z");
            const baseRow = {
                job_id: "dedup.job",
                scheduled_for: scheduledFor,
                status: "pending" as const,
                attempt: 1,
                claimed_by: null,
                started_at: null,
                finished_at: null,
                error: null,
            };

            await trx("sys_job_run").insert({
                id: "00000000-0000-0000-0000-000000000010",
                ...baseRow,
            });

            await expect(
                trx("sys_job_run").insert({
                    id: "00000000-0000-0000-0000-000000000011",
                    ...baseRow,
                }),
            ).rejects.toThrow();
        });
    });
}
