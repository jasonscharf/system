/**
 * TRN-156: validateSchedule — reject malformed Schedule descriptors at
 * registration time with actionable errors.
 *
 * Called when a job is registered so that misconfigured schedules fail fast
 * (at startup, not at 3am when the first fire is missed).
 */

import { parseDuration } from "./parseDuration.js";
import type { Schedule, Weekday } from "./types.js";

const VALID_WEEKDAYS: ReadonlySet<string> = new Set<Weekday>([
    "Mon",
    "Tue",
    "Wed",
    "Thu",
    "Fri",
    "Sat",
    "Sun",
]);

const TIME_OF_DAY_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;

/**
 * Validate a Schedule descriptor, throwing with an actionable message if it
 * is malformed. Safe to call at registration time (no DB access, no I/O).
 *
 * @throws Error if the schedule is not valid.
 */
export function validateSchedule(s: Schedule): void {
    if (typeof s !== "object" || s === null) {
        throw new Error(`validateSchedule: expected a Schedule object, got ${JSON.stringify(s)}.`);
    }

    if ("every" in s) {
        _validateEvery(s);
        return;
    }

    if ("daily" in s) {
        _validateDailyLike("daily", s.daily, s.tz);
        return;
    }

    if ("weekly" in s) {
        _validateWeekly(s);
        return;
    }

    if ("monthly" in s) {
        _validateMonthly(s);
        return;
    }

    if ("cron" in s) {
        _validateCron(s);
        return;
    }

    throw new Error(
        `validateSchedule: schedule must have one of: every, daily, weekly, monthly, cron. ` +
            `Got keys: ${Object.keys(s).join(", ")}.`,
    );
}

// ── Private validators ────────────────────────────────────────────────────────

function _validateEvery(s: { every: string; jitter?: string }): void {
    try {
        parseDuration(s.every);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`validateSchedule (every): invalid duration — ${msg}`);
    }

    if (s.jitter !== undefined) {
        try {
            parseDuration(s.jitter);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(`validateSchedule (every.jitter): invalid duration — ${msg}`);
        }
    }
}

function _validateDailyLike(field: string, timeOfDay: string, tz?: string): void {
    if (typeof timeOfDay !== "string" || !TIME_OF_DAY_RE.test(timeOfDay)) {
        throw new Error(
            `validateSchedule (${field}): time of day must be HH:MM or HH:MM:SS, got "${timeOfDay}".`,
        );
    }

    if (tz !== undefined) {
        _validateTz(field, tz);
    }
}

function _validateWeekly(s: { weekly: { day: string; at: string }; tz?: string }): void {
    if (typeof s.weekly !== "object" || s.weekly === null) {
        throw new Error(
            `validateSchedule (weekly): expected { day, at }, got ${JSON.stringify(s.weekly)}.`,
        );
    }

    if (!VALID_WEEKDAYS.has(s.weekly.day)) {
        throw new Error(
            `validateSchedule (weekly.day): must be one of Mon|Tue|Wed|Thu|Fri|Sat|Sun, ` +
                `got "${s.weekly.day}".`,
        );
    }

    _validateDailyLike("weekly.at", s.weekly.at, s.tz);
}

function _validateMonthly(s: { monthly: { day: number; at: string }; tz?: string }): void {
    if (typeof s.monthly !== "object" || s.monthly === null) {
        throw new Error(
            `validateSchedule (monthly): expected { day, at }, got ${JSON.stringify(s.monthly)}.`,
        );
    }

    const { day } = s.monthly;
    if (!Number.isInteger(day) || day < 1 || day > 31) {
        throw new Error(`validateSchedule (monthly.day): must be an integer 1–31, got ${day}.`);
    }

    _validateDailyLike("monthly.at", s.monthly.at, s.tz);
}

function _validateCron(s: { cron: string; tz?: string }): void {
    if (typeof s.cron !== "string" || s.cron.trim() === "") {
        throw new Error(
            `validateSchedule (cron): expression must be a non-empty string, got ${JSON.stringify(s.cron)}.`,
        );
    }

    // Light parse check: delegate to cron-parser to catch obvious errors early.
    // Import is dynamic to keep the validator synchronous-looking; cron-parser
    // is always available at this point (it's a static dep).
    try {
        // We import synchronously via require-style — cron-parser is CJS-compatible.
        // The actual validation here is a simple field count check; a full parse
        // happens at nextRun() time. This guards against obviously wrong strings.
        const parts = s.cron.trim().split(/\s+/);
        if (parts.length < 5 || parts.length > 6) {
            throw new Error(
                `expected 5 (minute-based) or 6 (second-based) fields, got ${parts.length}`,
            );
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`validateSchedule (cron): invalid expression "${s.cron}" — ${msg}`);
    }

    if (s.tz !== undefined) {
        _validateTz("cron", s.tz);
    }
}

function _validateTz(field: string, tz: string): void {
    try {
        // Validate by constructing a DateTimeFormat with the given timezone.
        // This accepts all valid IANA timezone names as well as "UTC" and
        // "Etc/UTC" — and throws a RangeError for anything unrecognised.
        // Note: Intl.supportedValuesOf("timeZone") does NOT include "UTC"
        // as a bare string, so we avoid that approach.
        new Intl.DateTimeFormat("en", { timeZone: tz });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
            `validateSchedule (${field}.tz): "${tz}" is not a recognised IANA timezone — ${msg}`,
        );
    }
}
