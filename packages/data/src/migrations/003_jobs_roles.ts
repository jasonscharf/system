import type { Knex } from "knex";

/**
 * TRN-154: Jobs & Roles control-plane schema.
 *
 * Creates three relational tables for the distributed scheduling and leader-
 * election system described in docs/jobs-and-roles.md:
 *
 *   sys_role_lease  — capped-N slot leases; expiry = free slot (no janitor needed)
 *   sys_job         — durable job registry with typed Schedule descriptor
 *   sys_job_run     — claim queue + audit log (pending|running|succeeded|failed|dead)
 *
 * Postgres and SQLite are both supported. SQLite is used for tests (in-memory);
 * Postgres is used in production. The `jsonb` type is used on Postgres and falls
 * back to `json` on SQLite via Knex's t.jsonb() mapping.
 *
 * sys_job_run.id is a text column on both backends. Knex's t.uuid() is
 * supported in recent better-sqlite3 versions but behaves identically to text
 * at the SQLite level; using t.text() avoids any driver version edge cases and
 * lets callers pass any UUID string (crypto.randomUUID(), uuidv4(), etc.).
 */

export async function up(knex: Knex): Promise<void> {
    const client = (knex.client as { config: { client: string } }).config.client;
    const isPg = client === "pg" || client === "postgresql";

    // ── sys_role_lease ────────────────────────────────────────────────────────

    if (!(await knex.schema.hasTable("sys_role_lease"))) {
        await knex.schema.createTable("sys_role_lease", (t) => {
            t.text("role").notNullable();
            t.smallint("slot").notNullable().defaultTo(0);
            t.text("holder_id").nullable();
            t.timestamp("acquired_at", { useTz: true }).nullable();
            t.timestamp("expires_at", { useTz: true }).notNullable();
            if (isPg) {
                t.specificType("meta", "jsonb").nullable();
            } else {
                t.json("meta").nullable();
            }
            t.primary(["role", "slot"]);
            t.index(["expires_at"], "sys_role_lease_expires_at_idx");
        });
    }

    // ── sys_job ───────────────────────────────────────────────────────────────

    if (!(await knex.schema.hasTable("sys_job"))) {
        await knex.schema.createTable("sys_job", (t) => {
            t.text("id").primary();
            if (isPg) {
                t.specificType("schedule", "jsonb").notNullable();
            } else {
                t.json("schedule").notNullable();
            }
            t.text("handler").notNullable();
            t.text("requires_role").nullable();
            t.boolean("enabled").notNullable().defaultTo(true);
            t.timestamp("next_run_at", { useTz: true }).notNullable();
            t.smallint("max_attempts").notNullable().defaultTo(1);
            if (isPg) {
                t.specificType("meta", "jsonb").nullable();
            } else {
                t.json("meta").nullable();
            }
            t.index(["enabled", "next_run_at"], "sys_job_enabled_next_run_at_idx");
        });
    }

    // ── sys_job_run ───────────────────────────────────────────────────────────

    if (!(await knex.schema.hasTable("sys_job_run"))) {
        await knex.schema.createTable("sys_job_run", (t) => {
            // Use text for portability across Postgres and SQLite. Callers supply
            // a UUID string (e.g. crypto.randomUUID()); the DB stores it as text.
            t.text("id").primary();
            t.text("job_id").notNullable().references("id").inTable("sys_job");
            t.timestamp("scheduled_for", { useTz: true }).notNullable();
            t.text("status").notNullable();
            t.smallint("attempt").notNullable().defaultTo(1);
            t.text("claimed_by").nullable();
            t.timestamp("started_at", { useTz: true }).nullable();
            t.timestamp("finished_at", { useTz: true }).nullable();
            t.text("error").nullable();
            t.unique(["job_id", "scheduled_for", "attempt"], {
                useConstraint: true,
            });
            t.index(["status", "scheduled_for"], "sys_job_run_status_scheduled_for_idx");
        });
    }
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists("sys_job_run");
    await knex.schema.dropTableIfExists("sys_job");
    await knex.schema.dropTableIfExists("sys_role_lease");
}
