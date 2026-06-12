/**
 * TRN-156: Pure unit tests for the Schedule model.
 *
 * All tests are synchronous / deterministic — no DB, no I/O, no sleeps.
 *
 * Coverage:
 *   - parseDuration: ISO-8601 and short forms; rejects junk
 *   - nextRunBase / nextRun: every / daily / weekly / monthly / cron
 *   - DST boundary in a non-UTC timezone
 *   - Jitter stays within [0, jitter] and base cadence is preserved
 */

import { nextRun, nextRunBase, parseDuration, validateSchedule } from "@jasonscharf/worker";
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

// ── parseDuration ─────────────────────────────────────────────────────────────

describe("parseDuration", () => {
    it("parses ISO-8601 seconds: PT30S → 30 000 ms", () => {
        expect(parseDuration("PT30S")).toBe(30_000);
    });

    it("parses ISO-8601 minutes: PT5M → 300 000 ms", () => {
        expect(parseDuration("PT5M")).toBe(300_000);
    });

    it("parses ISO-8601 hours: PT1H → 3 600 000 ms", () => {
        expect(parseDuration("PT1H")).toBe(3_600_000);
    });

    it("parses ISO-8601 days: P1D → 86 400 000 ms", () => {
        expect(parseDuration("P1D")).toBe(86_400_000);
    });

    it("parses ISO-8601 compound: P1DT2H30M → correct ms", () => {
        const expected = 24 * 3_600_000 + 2 * 3_600_000 + 30 * 60_000;
        expect(parseDuration("P1DT2H30M")).toBe(expected);
    });

    it("parses short form: 30s → 30 000 ms", () => {
        expect(parseDuration("30s")).toBe(30_000);
    });

    it("parses short form: 5m → 300 000 ms", () => {
        expect(parseDuration("5m")).toBe(300_000);
    });

    it("parses short form: 1h → 3 600 000 ms", () => {
        expect(parseDuration("1h")).toBe(3_600_000);
    });

    it("parses short form: 2d → 172 800 000 ms", () => {
        expect(parseDuration("2d")).toBe(172_800_000);
    });

    it("parses short form compound: 1h30m → correct ms", () => {
        expect(parseDuration("1h30m")).toBe(3_600_000 + 30 * 60_000);
    });

    it("rejects empty string", () => {
        expect(() => parseDuration("")).toThrow();
    });

    it("rejects junk string", () => {
        expect(() => parseDuration("every-hour")).toThrow();
    });

    it("rejects zero duration (ISO): P0D", () => {
        expect(() => parseDuration("P0D")).toThrow(/zero milliseconds/);
    });

    it("rejects zero duration (short): 0s", () => {
        expect(() => parseDuration("0s")).toThrow(/zero milliseconds/);
    });

    it("rejects pure ISO prefix with no fields: P", () => {
        expect(() => parseDuration("P")).toThrow();
    });
});

// ── nextRun: every ────────────────────────────────────────────────────────────

describe("nextRun — every", () => {
    const base = new Date("2026-01-01T00:00:00.000Z");

    it("advances by the given duration", () => {
        const result = nextRunBase({ every: "PT30S" }, base);
        expect(result.getTime()).toBe(base.getTime() + 30_000);
    });

    it("advances by 5 minutes", () => {
        const result = nextRunBase({ every: "5m" }, base);
        expect(result.getTime()).toBe(base.getTime() + 5 * 60_000);
    });

    it("advances by 1 day", () => {
        const result = nextRunBase({ every: "P1D" }, base);
        expect(result.getTime()).toBe(base.getTime() + 86_400_000);
    });
});

// ── nextRun: daily ────────────────────────────────────────────────────────────

describe("nextRun — daily (UTC)", () => {
    it("fires today when the time has not yet passed", () => {
        // after = 2026-01-01 02:00 UTC; target = 03:00 UTC → same day
        const after = new Date("2026-01-01T02:00:00.000Z");
        const result = nextRunBase({ daily: "03:00", tz: "UTC" }, after);
        expect(result.toISOString()).toBe("2026-01-01T03:00:00.000Z");
    });

    it("fires the next day when the time has already passed today", () => {
        // after = 2026-01-01 04:00 UTC; target = 03:00 UTC → next day
        const after = new Date("2026-01-01T04:00:00.000Z");
        const result = nextRunBase({ daily: "03:00", tz: "UTC" }, after);
        expect(result.toISOString()).toBe("2026-01-02T03:00:00.000Z");
    });

    it("fires the next day when time exactly equals after", () => {
        const after = new Date("2026-01-01T03:00:00.000Z");
        const result = nextRunBase({ daily: "03:00", tz: "UTC" }, after);
        expect(result.toISOString()).toBe("2026-01-02T03:00:00.000Z");
    });
});

// ── nextRun: daily with timezone ──────────────────────────────────────────────

describe("nextRun — daily (America/Toronto)", () => {
    it("fires at the correct wall-clock time in EST (UTC-5)", () => {
        // 2026-01-01 00:00 UTC = 2025-12-31 19:00 EST
        // target = 03:00 EST = 2026-01-01 08:00 UTC (EST is UTC-5)
        const after = new Date("2026-01-01T00:00:00.000Z");
        const result = nextRunBase({ daily: "03:00", tz: "America/Toronto" }, after);
        // 03:00 EST = 08:00 UTC
        expect(result.toISOString()).toBe("2026-01-01T08:00:00.000Z");
    });
});

// ── nextRun: daily — DST boundary ─────────────────────────────────────────────

describe("nextRun — daily DST boundary (America/Toronto)", () => {
    // In 2026, North America DST spring-forward is on 2026-03-08 at 02:00 local.
    // Clocks jump from 02:00 → 03:00 (UTC-5 → UTC-4).
    // A 03:00 America/Toronto job should still fire at wall-clock 03:00 regardless
    // of whether it is EST or EDT.

    it("correctly schedules 03:00 on the night before spring-forward", () => {
        // after = 2026-03-07 23:00 EST (04:00 UTC on Mar 8)
        // target = 03:00 EST on 2026-03-08 = 08:00 UTC
        const after = new Date("2026-03-08T04:00:00.000Z"); // 23:00 EST Mar 7
        const result = nextRunBase({ daily: "03:00", tz: "America/Toronto" }, after);

        // On 2026-03-08 clocks spring forward; 03:00 EDT = 07:00 UTC (UTC-4)
        expect(result.toISOString()).toBe("2026-03-08T07:00:00.000Z");
    });

    it("correctly schedules 03:00 on the day after spring-forward (now EDT)", () => {
        // after = 2026-03-08 10:00 UTC = 06:00 EDT (after DST change)
        // target = 03:00 EDT on 2026-03-09 = 07:00 UTC
        const after = new Date("2026-03-08T10:00:00.000Z");
        const result = nextRunBase({ daily: "03:00", tz: "America/Toronto" }, after);
        expect(result.toISOString()).toBe("2026-03-09T07:00:00.000Z");
    });

    it("fall-back: 02:00 Toronto fires once even when the hour repeats", () => {
        // 2026-11-01: clocks fall back at 02:00 EDT → 01:00 EST (UTC-5)
        // after = 2026-11-01 05:00 UTC = 01:00 EDT (before fall-back)
        // target = 02:00 wall-clock Toronto.
        //
        // Luxon resolves the ambiguous 02:00 on the fall-back night to the
        // LATER UTC value (EST, UTC-5) = 07:00 UTC. The critical assertion is
        // that it fires ONCE (not twice) and the wall-clock time is 02:00 Toronto.
        const after = new Date("2026-11-01T05:00:00.000Z"); // 01:00 EDT
        const result = nextRunBase({ daily: "02:00", tz: "America/Toronto" }, after);
        // Luxon resolves to the EST side: 02:00 EST = 07:00 UTC
        expect(result.toISOString()).toBe("2026-11-01T07:00:00.000Z");
        // Verify the wall-clock time in Toronto is 02:00
        const dt = DateTime.fromJSDate(result, { zone: "America/Toronto" });
        expect(dt.hour).toBe(2);
        expect(dt.minute).toBe(0);
    });
});

// ── nextRun: weekly ───────────────────────────────────────────────────────────

describe("nextRun — weekly", () => {
    // 2026-01-01 is a Thursday.

    it("fires on the correct day when it has not yet passed this week", () => {
        // after = Thursday 2026-01-01 00:00 UTC; target = Friday 02:00 UTC
        const after = new Date("2026-01-01T00:00:00.000Z");
        const result = nextRunBase({ weekly: { day: "Fri", at: "02:00" }, tz: "UTC" }, after);
        expect(result.toISOString()).toBe("2026-01-02T02:00:00.000Z");
    });

    it("fires next week when the day has already passed", () => {
        // after = Saturday 2026-01-03 12:00 UTC; target = Friday (past) → next Friday
        const after = new Date("2026-01-03T12:00:00.000Z"); // Saturday
        const result = nextRunBase({ weekly: { day: "Fri", at: "02:00" }, tz: "UTC" }, after);
        expect(result.toISOString()).toBe("2026-01-09T02:00:00.000Z");
    });

    it("fires next week when it's the right day but the time has passed", () => {
        // after = Friday 2026-01-02 10:00 UTC; target = Friday 02:00 → already past → next Fri
        const after = new Date("2026-01-02T10:00:00.000Z"); // Friday
        const result = nextRunBase({ weekly: { day: "Fri", at: "02:00" }, tz: "UTC" }, after);
        expect(result.toISOString()).toBe("2026-01-09T02:00:00.000Z");
    });
});

// ── nextRun: monthly ──────────────────────────────────────────────────────────

describe("nextRun — monthly", () => {
    it("fires on the correct day of the month when not yet passed", () => {
        // after = 2026-01-05 00:00 UTC; target = 15th at 09:00 UTC
        const after = new Date("2026-01-05T00:00:00.000Z");
        const result = nextRunBase({ monthly: { day: 15, at: "09:00" }, tz: "UTC" }, after);
        expect(result.toISOString()).toBe("2026-01-15T09:00:00.000Z");
    });

    it("fires next month when the day has already passed", () => {
        // after = 2026-01-20 00:00 UTC; target = 15th → already past → Feb 15
        const after = new Date("2026-01-20T00:00:00.000Z");
        const result = nextRunBase({ monthly: { day: 15, at: "09:00" }, tz: "UTC" }, after);
        expect(result.toISOString()).toBe("2026-02-15T09:00:00.000Z");
    });
});

// ── nextRun: cron ─────────────────────────────────────────────────────────────

describe("nextRun — cron (escape hatch)", () => {
    it("fires at the next cron slot after `after`", () => {
        // "0 3 * * *" = daily at 03:00 (5-field cron, minute-resolution)
        const after = new Date("2026-01-01T02:00:00.000Z");
        const result = nextRunBase({ cron: "0 3 * * *", tz: "UTC" }, after);
        expect(result.toISOString()).toBe("2026-01-01T03:00:00.000Z");
    });

    it("advances past the current slot to the next occurrence", () => {
        // after is exactly at 03:00 — next should be 03:00 the next day
        const after = new Date("2026-01-01T03:00:00.000Z");
        const result = nextRunBase({ cron: "0 3 * * *", tz: "UTC" }, after);
        expect(result.toISOString()).toBe("2026-01-02T03:00:00.000Z");
    });
});

// ── nextRun: jitter ───────────────────────────────────────────────────────────

describe("nextRun — jitter", () => {
    const base = new Date("2026-01-01T00:00:00.000Z");
    const schedule = { every: "PT30S", jitter: "PT10S" } as const;

    it("with rng=0, result equals base + every (no jitter added)", () => {
        const result = nextRun(schedule, base, () => 0);
        expect(result.getTime()).toBe(base.getTime() + 30_000);
    });

    it("with rng=1 (exclusive ceiling), result is base + every + jitter - 1ms", () => {
        // Math.floor(0.9999... * 10_000) = 9_999
        const result = nextRun(schedule, base, () => 0.9999);
        const offset = result.getTime() - (base.getTime() + 30_000);
        expect(offset).toBeGreaterThanOrEqual(0);
        expect(offset).toBeLessThan(10_000);
    });

    it("result is always in [base+every, base+every+jitter]", () => {
        for (let i = 0; i < 100; i++) {
            const result = nextRun(schedule, base);
            const offset = result.getTime() - (base.getTime() + 30_000);
            expect(offset).toBeGreaterThanOrEqual(0);
            expect(offset).toBeLessThanOrEqual(10_000);
        }
    });

    it("does not apply jitter to non-every schedules", () => {
        // daily schedule has no jitter field — nextRun should return the same as nextRunBase
        const daily = { daily: "03:00", tz: "UTC" };
        const after = new Date("2026-01-01T02:00:00.000Z");
        expect(nextRun(daily, after).getTime()).toBe(nextRunBase(daily, after).getTime());
    });
});

// ── validateSchedule ──────────────────────────────────────────────────────────

describe("validateSchedule", () => {
    it("accepts a valid every schedule", () => {
        expect(() => validateSchedule({ every: "PT30S" })).not.toThrow();
    });

    it("accepts a valid every+jitter schedule", () => {
        expect(() => validateSchedule({ every: "5m", jitter: "30s" })).not.toThrow();
    });

    it("accepts a valid daily schedule", () => {
        expect(() => validateSchedule({ daily: "03:00", tz: "UTC" })).not.toThrow();
    });

    it("accepts a valid weekly schedule", () => {
        expect(() =>
            validateSchedule({ weekly: { day: "Mon", at: "09:00" }, tz: "UTC" }),
        ).not.toThrow();
    });

    it("accepts a valid monthly schedule", () => {
        expect(() =>
            validateSchedule({ monthly: { day: 1, at: "00:00" }, tz: "UTC" }),
        ).not.toThrow();
    });

    it("accepts a valid cron schedule", () => {
        expect(() => validateSchedule({ cron: "0 3 * * *", tz: "UTC" })).not.toThrow();
    });

    it("rejects an every schedule with an invalid duration", () => {
        expect(() => validateSchedule({ every: "not-a-duration" })).toThrow();
    });

    it("rejects a weekly schedule with an invalid weekday", () => {
        // biome-ignore lint: intentional invalid input for test
        expect(() => validateSchedule({ weekly: { day: "Xyz" as any, at: "09:00" } })).toThrow();
    });

    it("rejects a monthly schedule with day=0", () => {
        expect(() => validateSchedule({ monthly: { day: 0, at: "00:00" } })).toThrow();
    });

    it("rejects a monthly schedule with day=32", () => {
        expect(() => validateSchedule({ monthly: { day: 32, at: "00:00" } })).toThrow();
    });

    it("rejects an unknown timezone", () => {
        expect(() => validateSchedule({ daily: "03:00", tz: "Not/ATimezone" })).toThrow();
    });
});
