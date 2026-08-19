/**
 * Conditional, well-formatted Knex SQL logging.
 *
 * Gated behind the SYS_DB_LOG_SQL environment flag.  When enabled, every query
 * a Knex instance runs is emitted with its bindings interpolated inline and its
 * wall-clock duration, e.g.
 *
 *   [sql 1.8ms] insert into "edges" ("object", "subject") values (42, 7)
 *
 * The formatting helpers are pure and exported so they can be tested directly
 * with real inputs (no console capture, no mocks).
 */

import type { Knex } from "knex";

/** Environment flag that turns SQL logging on. */
export const SQL_LOG_FLAG = "SYS_DB_LOG_SQL";

/** A sink for formatted SQL log lines (the platform logger at runtime, a collector in tests). */
export type SqlLogSink = (line: string) => void;

/**
 * True when the SYS_DB_LOG_SQL flag is set to anything other than an explicit
 * off value ("", "0", "false").  Reads process.env at call time.
 */
export function sqlLoggingEnabled(): boolean {
    const value = process.env[SQL_LOG_FLAG];
    if (value === undefined) {
        return false;
    }
    const normalized = value.trim().toLowerCase();
    return normalized !== "" && normalized !== "0" && normalized !== "false";
}

/** Renders a single binding as a SQL-literal-ish token for the log line. */
export function formatBinding(value: unknown): string {
    if (value === null || value === undefined) {
        return "NULL";
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    if (value instanceof Date) {
        return `'${value.toISOString()}'`;
    }
    return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Interpolates a query's bindings into its SQL for human-readable logging.
 * Handles both the Postgres ($1..$n) and the SQLite/MySQL (?) placeholder
 * styles.  This is a best-effort rendering for logs only — never executed.
 */
export function interpolateSql(sql: string, bindings: readonly unknown[]): string {
    if (bindings.length === 0) {
        return sql;
    }
    if (/\$\d+/.test(sql)) {
        return sql.replace(/\$(\d+)/g, (_match, n) => formatBinding(bindings[Number(n) - 1]));
    }
    let i = 0;
    return sql.replace(/\?/g, () => formatBinding(bindings[i++]));
}

interface QueryEvent {
    __knexQueryUid: string;
    sql: string;
    bindings: readonly unknown[];
}

/**
 * Attaches query / query-response / query-error listeners that emit formatted
 * SQL to `sink`.  Returns the same knex instance for chaining.
 */
export function attachSqlLogging(knex: Knex, sink: SqlLogSink): Knex {
    const startedAt = new Map<string, number>();

    knex.on("query", (event: QueryEvent) => {
        startedAt.set(event.__knexQueryUid, Date.now());
    });

    const elapsed = (uid: string): string => {
        const start = startedAt.get(uid);
        /* v8 ignore start -- defensive: a response without a matching query event has no start time */
        if (start === undefined) {
            return "";
        }
        /* v8 ignore stop */
        startedAt.delete(uid);
        return ` ${Date.now() - start}ms`;
    };

    knex.on("query-response", (_response: unknown, event: QueryEvent) => {
        sink(`[sql${elapsed(event.__knexQueryUid)}] ${interpolateSql(event.sql, event.bindings)}`);
    });

    knex.on("query-error", (error: unknown, event: QueryEvent) => {
        sink(
            `[sql-error${elapsed(event.__knexQueryUid)}] ${interpolateSql(event.sql, event.bindings)} -- ${error}`,
        );
    });

    return knex;
}
