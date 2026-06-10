import type { Knex } from "knex";
import { up as migrate001 } from "./migrations/001_init.js";
import { recordMigrationBaseline } from "./migrationBaseline.js";
import { attachSqlLogging, sqlLoggingEnabled } from "./sqlLogging.js";

export type DbClient = "sqlite" | "pg";

export interface SqliteConfig {
    readonly client: "sqlite";
    /** Pass ':memory:' for an in-process ephemeral database (tests). */
    readonly filename: string;
}

export interface PgConfig {
    readonly client: "pg";
    readonly host: string;
    readonly port?: number;
    readonly database: string;
    readonly user: string;
    readonly password: string;
}

export type DataConfig = SqliteConfig | PgConfig;

/**
 * Creates and migrates a Knex instance for the given configuration.
 * Call `knex.destroy()` when finished to release the connection pool.
 */
export async function createDataContext(config: DataConfig): Promise<Knex> {
    const { default: Knex } = await import("knex");

    let knex: Knex;

    if (config.client === "sqlite") {
        knex = Knex({
            client: "better-sqlite3",
            connection: { filename: config.filename },
            useNullAsDefault: true,
            // A single connection: a ':memory:' database is private to its
            // connection, so a multi-connection pool would scatter writes and
            // reads across separate empty databases. One connection also matches
            // better-sqlite3's synchronous, single-writer model.
            pool: { min: 1, max: 1 },
        });
    } else {
        knex = Knex({
            client: "pg",
            connection: {
                host: config.host,
                port: config.port ?? 5432,
                database: config.database,
                user: config.user,
                password: config.password,
            },
            // Cap per-context pools and don't hoard idle connections — many test
            // files open pools concurrently against one Postgres, so an
            // unbounded default pool (min 2, max 10) starves the shared server.
            pool: { min: 0, max: 4 },
        });
    }

    if (sqlLoggingEnabled()) {
        attachSqlLogging(knex, (line) => console.log(line));
    }

    await migrate001(knex);
    await recordMigrationBaseline(knex);
    return knex;
}
