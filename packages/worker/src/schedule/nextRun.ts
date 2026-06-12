/**
 * TRN-156: nextRun — the single pure scheduling function.
 *
 * All five Schedule variants collapse to one call: nextRun(schedule, after).
 * This is the only scheduling logic in the system and is exhaustively testable.
 *
 * Libraries:
 *   - luxon (DateTime) for daily/weekly/monthly wall-clock math with DST safety.
 *   - cron-parser for the cron escape-hatch variant.
 *
 * The jitter wrapper is split from the deterministic core (nextRunBase) so
 * tests can assert bounds without randomness.
 */

import { CronExpressionParser } from "cron-parser";
import { DateTime } from "luxon";
import { parseDuration } from "./parseDuration.js";
import type { Schedule, Weekday } from "./types.js";

// ── Weekday mapping ───────────────────────────────────────────────────────────

/** luxon uses ISO weekday numbers: 1 = Mon, 7 = Sun. */
const WEEKDAY_TO_ISO: Record<Weekday, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
};

// ── Time-of-day parsing ───────────────────────────────────────────────────────

interface TimeOfDayParts {
    hour: number;
    minute: number;
    second: number;
}

/**
 * Parse a HH:MM or HH:MM:SS time-of-day string.
 * Throws with an actionable message on bad input.
 */
function parseTimeOfDay(s: string): TimeOfDayParts {
    const parts = s.split(":");
    if (parts.length < 2 || parts.length > 3) {
        throw new Error(`nextRun: invalid time-of-day "${s}". Expected HH:MM or HH:MM:SS.`);
    }

    const hour = Number(parts[0]);
    const minute = Number(parts[1]);
    const second = parts[2] !== undefined ? Number(parts[2]) : 0;

    if (
        !Number.isInteger(hour) ||
        !Number.isInteger(minute) ||
        !Number.isInteger(second) ||
        hour < 0 ||
        hour > 23 ||
        minute < 0 ||
        minute > 59 ||
        second < 0 ||
        second > 59
    ) {
        throw new Error(
            `nextRun: invalid time-of-day "${s}". ` +
                `Hour must be 0-23, minute/second must be 0-59.`,
        );
    }

    return { hour, minute, second };
}

// ── nextRunBase — deterministic core (no jitter) ──────────────────────────────

/**
 * Compute the next run time for a schedule, starting strictly after `after`.
 * Pure and deterministic — no jitter, no side effects.
 *
 * For daily/weekly/monthly: uses Luxon DateTime to perform wall-clock math in
 * the given IANA timezone. DST transitions are handled correctly because Luxon
 * keeps the wall-clock time fixed and adjusts the UTC offset, rather than
 * adding a fixed millisecond delta.
 *
 * For cron: delegates to cron-parser with currentDate = after.
 */
export function nextRunBase(schedule: Schedule, after: Date): Date {
    if ("every" in schedule) {
        const ms = parseDuration(schedule.every);
        return new Date(after.getTime() + ms);
    }

    if ("daily" in schedule) {
        return _nextDaily(schedule.daily, schedule.tz ?? "UTC", after);
    }

    if ("weekly" in schedule) {
        return _nextWeekly(schedule.weekly.day, schedule.weekly.at, schedule.tz ?? "UTC", after);
    }

    if ("monthly" in schedule) {
        return _nextMonthly(schedule.monthly.day, schedule.monthly.at, schedule.tz ?? "UTC", after);
    }

    if ("cron" in schedule) {
        return _nextCron(schedule.cron, schedule.tz ?? "UTC", after);
    }

    // TypeScript exhaustiveness — should never reach here.
    throw new Error(`nextRun: unrecognised schedule variant: ${JSON.stringify(schedule)}`);
}

// ── nextRun — with optional jitter ───────────────────────────────────────────

/**
 * Compute the next run time, applying jitter if the schedule specifies one.
 *
 * For the `every` variant with a `jitter` field: a uniform random offset in
 * [0, jitter_ms] is added to the base next-run time. This spreads herds of
 * jobs that share a cadence.
 *
 * An injectable RNG is accepted so callers can seed it for deterministic tests.
 * Defaults to Math.random.
 *
 * @param rng Optional random number generator returning a value in [0, 1).
 */
export function nextRun(schedule: Schedule, after: Date, rng: () => number = Math.random): Date {
    const base = nextRunBase(schedule, after);

    if ("every" in schedule && schedule.jitter !== undefined) {
        const jitterMs = parseDuration(schedule.jitter);
        const offset = Math.floor(rng() * jitterMs);
        return new Date(base.getTime() + offset);
    }

    return base;
}

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Next daily fire strictly after `after` in the given IANA timezone.
 *
 * Computes the candidate fire for the same calendar date as `after` (in the
 * tz), then advances by one day if the candidate is not strictly after `after`.
 * Luxon keeps wall-clock time fixed across DST transitions, so 03:00
 * America/Toronto fires at 03:00 both before and after the clocks change.
 */
function _nextDaily(timeOfDay: string, tz: string, after: Date): Date {
    const { hour, minute, second } = parseTimeOfDay(timeOfDay);

    // Convert `after` to the target timezone.
    const afterDt = DateTime.fromJSDate(after, { zone: tz });

    // Candidate: same calendar date, specified wall-clock time.
    let candidate = afterDt.set({ hour, minute, second, millisecond: 0 });

    if (candidate.toMillis() <= afterDt.toMillis()) {
        candidate = candidate.plus({ days: 1 });
    }

    return candidate.toJSDate();
}

/**
 * Next weekly fire strictly after `after` in the given IANA timezone.
 */
function _nextWeekly(day: Weekday, timeOfDay: string, tz: string, after: Date): Date {
    const { hour, minute, second } = parseTimeOfDay(timeOfDay);
    const targetIsoWeekday = WEEKDAY_TO_ISO[day];

    const afterDt = DateTime.fromJSDate(after, { zone: tz });

    // Start with the candidate on the current week at the right wall-clock time.
    let candidate = afterDt.set({ hour, minute, second, millisecond: 0 });

    // Advance to the correct weekday.
    const currentIsoWeekday = afterDt.weekday;
    const daysUntilTarget = (targetIsoWeekday - currentIsoWeekday + 7) % 7;
    candidate = candidate.plus({ days: daysUntilTarget });

    if (candidate.toMillis() <= afterDt.toMillis()) {
        // Same weekday but already past — advance a full week.
        candidate = candidate.plus({ weeks: 1 });
    }

    return candidate.toJSDate();
}

/**
 * Next monthly fire strictly after `after` in the given IANA timezone.
 *
 * If the target day does not exist in a given month (e.g. day 31 in April),
 * Luxon clamps to the last valid day of that month.
 */
function _nextMonthly(day: number, timeOfDay: string, tz: string, after: Date): Date {
    if (!Number.isInteger(day) || day < 1 || day > 31) {
        throw new Error(`nextRun: monthly.day must be an integer between 1 and 31, got ${day}.`);
    }

    const { hour, minute, second } = parseTimeOfDay(timeOfDay);
    const afterDt = DateTime.fromJSDate(after, { zone: tz });

    // Candidate: same month, specified day and wall-clock time.
    let candidate = afterDt.set({ day, hour, minute, second, millisecond: 0 });

    if (candidate.toMillis() <= afterDt.toMillis()) {
        candidate = candidate
            .plus({ months: 1 })
            .set({ day, hour, minute, second, millisecond: 0 });
    }

    return candidate.toJSDate();
}

/**
 * Next cron fire strictly after `after` in the given IANA timezone.
 * Delegates entirely to cron-parser; this branch is the escape hatch only.
 */
function _nextCron(expression: string, tz: string, after: Date): Date {
    try {
        const parsed = CronExpressionParser.parse(expression, {
            currentDate: after,
            tz,
        });
        const next = parsed.next();
        return next.toDate();
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
            `nextRun: cron expression "${expression}" failed to parse or advance: ${msg}`,
        );
    }
}
