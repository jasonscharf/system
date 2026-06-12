/**
 * Migration idempotency.
 *
 * createDataContext re-runs every migration (001/002/003) on each connect — it
 * has no applied-migrations ledger. So every migration must be a no-op against
 * an already-migrated database; otherwise a second connection to the same
 * persistent database (a second worker replica sharing one Postgres, or simply
 * reconnecting) fails on a non-idempotent step.
 *
 * Regression: migrate002 unconditionally renamed `nodes.datatype` → `dt` and
 * added `nodes.v`/`vh`, which threw "column datatype does not exist" / "column
 * v already exists" on the second connect.
 *
 * A SQLite *file* (not :memory:, which is private per connection) reproduces the
 * shared-database scenario deterministically without needing Postgres: the
 * second createDataContext re-runs the migrations against the populated file.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDataContext } from "@jasonscharf/data";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("Migration idempotency — SQLite (shared file)", () => {
    let dir: string;
    let file: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "sys-migrate-idem-"));
        file = join(dir, "db.sqlite");
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it("re-running migrations against an already-migrated database is a no-op", async () => {
        // First connect migrates the fresh file.
        const first = await createDataContext({ client: "sqlite", filename: file });
        await first.destroy();

        // Second connect re-runs every migration against the populated file.
        // This previously threw on migrate002's unconditional rename / column add.
        const second = await createDataContext({ client: "sqlite", filename: file });

        try {
            // Schema is intact and correct after the second run.
            expect(await second.schema.hasColumn("nodes", "dt")).toBe(true);
            expect(await second.schema.hasColumn("nodes", "datatype")).toBe(false);
            expect(await second.schema.hasColumn("nodes", "v")).toBe(true);
            expect(await second.schema.hasColumn("nodes", "vh")).toBe(true);
            // Later migrations are reachable + idempotent too.
            expect(await second.schema.hasTable("sys_job")).toBe(true);
            expect(await second.schema.hasTable("sys_job_run")).toBe(true);
            expect(await second.schema.hasTable("sys_role_lease")).toBe(true);
        } finally {
            await second.destroy();
        }
    });

    it("survives a third connect (stably idempotent, not just once)", async () => {
        for (let i = 0; i < 3; i++) {
            const knex = await createDataContext({ client: "sqlite", filename: file });
            await knex.destroy();
        }

        const final = await createDataContext({ client: "sqlite", filename: file });
        try {
            expect(await final.schema.hasColumn("nodes", "dt")).toBe(true);
            expect(await final.schema.hasColumn("nodes", "v")).toBe(true);
        } finally {
            await final.destroy();
        }
    });
});
