import type { Knex } from 'knex';
import { up as migrate001 } from './migrations/001_init.js';
import { up as migrate002 } from './migrations/002_time_series.js';
import { up as migrate003 } from './migrations/003_timestamps.js';


export type DbClient = 'sqlite' | 'pg';

export interface SqliteConfig {
    readonly client: 'sqlite';
    /** Pass ':memory:' for an in-process ephemeral database (tests). */
    readonly filename: string;
}

export interface PgConfig {
    readonly client: 'pg';
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
    const { default: Knex } = await import('knex');

    let knex: Knex;

    if (config.client === 'sqlite') {
        knex = Knex({
            client: 'better-sqlite3',
            connection: { filename: config.filename },
            useNullAsDefault: true,
        });
    } else {
        knex = Knex({
            client: 'pg',
            connection: {
                host:     config.host,
                port:     config.port ?? 5432,
                database: config.database,
                user:     config.user,
                password: config.password,
            },
        });
    }

    await migrate001(knex);
    await migrate002(knex);
    await migrate003(knex);
    return knex;
}
