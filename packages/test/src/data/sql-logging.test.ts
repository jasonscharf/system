/**
 * SQL logging tests.
 *
 * The formatting helpers are pure and tested directly with real values.  The
 * Knex event wiring is exercised against a real SQLite instance with a real
 * in-memory collector sink (no console capture, no mocks) — the array of
 * captured lines IS the observability layer.
 */

import {
    attachSqlLogging,
    createDataContext,
    formatBinding,
    interpolateSql,
    SQL_LOG_FLAG,
    sqlLoggingEnabled,
} from "@jasonscharf/data";
import type { Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ── sqlLoggingEnabled ───────────────────────────────────────────────────────────

describe("sqlLoggingEnabled", () => {
    const original = process.env[SQL_LOG_FLAG];

    afterEach(() => {
        if (original === undefined) {
            delete process.env[SQL_LOG_FLAG];
        } else {
            process.env[SQL_LOG_FLAG] = original;
        }
    });

    it("test disabled when unset", () => {
        delete process.env[SQL_LOG_FLAG];
        expect(sqlLoggingEnabled()).toBe(false);
    });

    it("test disabled for explicit off values", () => {
        for (const off of ["", "0", "false", "FALSE", "  "]) {
            process.env[SQL_LOG_FLAG] = off;
            expect(sqlLoggingEnabled()).toBe(false);
        }
    });

    it("test enabled for truthy values", () => {
        for (const on of ["1", "true", "yes", "debug"]) {
            process.env[SQL_LOG_FLAG] = on;
            expect(sqlLoggingEnabled()).toBe(true);
        }
    });
});

// ── formatBinding ───────────────────────────────────────────────────────────────

describe("formatBinding", () => {
    it("test renders null and undefined as NULL", () => {
        expect(formatBinding(null)).toBe("NULL");
        expect(formatBinding(undefined)).toBe("NULL");
    });

    it("test renders numbers and booleans bare", () => {
        expect(formatBinding(42)).toBe("42");
        expect(formatBinding(0)).toBe("0");
        expect(formatBinding(true)).toBe("true");
        expect(formatBinding(false)).toBe("false");
    });

    it("test renders dates as ISO literals", () => {
        const d = new Date("2026-06-05T00:00:00.000Z");
        expect(formatBinding(d)).toBe("'2026-06-05T00:00:00.000Z'");
    });

    it("test quotes strings and escapes single quotes", () => {
        expect(formatBinding("hello")).toBe("'hello'");
        expect(formatBinding("O'Brien")).toBe("'O''Brien'");
    });
});

// ── interpolateSql ──────────────────────────────────────────────────────────────

describe("interpolateSql", () => {
    it("test returns sql unchanged when no bindings", () => {
        expect(interpolateSql("select 1", [])).toBe("select 1");
    });

    it("test interpolates question-mark placeholders in order", () => {
        expect(interpolateSql("insert into t (a, b) values (?, ?)", [1, "x"])).toBe(
            "insert into t (a, b) values (1, 'x')",
        );
    });

    it("test interpolates positional postgres placeholders", () => {
        expect(interpolateSql("select * from t where a = $1 and b = $2", [7, "y"])).toBe(
            "select * from t where a = 7 and b = 'y'",
        );
    });
});

// ── attachSqlLogging (real SQLite) ──────────────────────────────────────────────

describe("attachSqlLogging", () => {
    let knex: Knex;
    let lines: string[];

    beforeEach(async () => {
        knex = await createDataContext({ client: "sqlite", filename: ":memory:" });
        lines = [];
        attachSqlLogging(knex, (line) => lines.push(line));
    });

    afterEach(async () => {
        await knex.destroy();
    });

    it("test logs a formatted line with bindings for a successful query", async () => {
        lines.length = 0;
        await knex("tern_names").insert({ iri: "http://example.org/thing" });

        const insertLine = lines.find((l) => l.startsWith("[sql") && l.includes("insert"));
        expect(insertLine).toBeDefined();
        expect(insertLine).toContain("'http://example.org/thing'");
        expect(insertLine).toMatch(/\[sql( \d+ms)?\]/);
    });

    it("test logs an error line for a failing query", async () => {
        lines.length = 0;
        await expect(knex.raw("select * from does_not_exist")).rejects.toThrow();

        const errorLine = lines.find((l) => l.startsWith("[sql-error"));
        expect(errorLine).toBeDefined();
        expect(errorLine).toContain("does_not_exist");
    });
});

// ── createDataContext wiring ────────────────────────────────────────────────────

describe("createDataContext SQL logging wiring", () => {
    const original = process.env[SQL_LOG_FLAG];

    afterEach(() => {
        if (original === undefined) {
            delete process.env[SQL_LOG_FLAG];
        } else {
            process.env[SQL_LOG_FLAG] = original;
        }
    });

    it("test attaches logging when the flag is set", async () => {
        process.env[SQL_LOG_FLAG] = "1";
        const knex = await createDataContext({ client: "sqlite", filename: ":memory:" });
        // A single real query runs through the console sink without throwing.
        await expect(knex("tern_names").select("*")).resolves.toBeDefined();
        await knex.destroy();
    });
});
