/**
 * TRN-156: Typed Schedule descriptor stored in sys_job.schedule (jsonb).
 *
 * Five variants, all timezone-aware, all collapsing to one pure function
 * (nextRun) that is the only scheduling logic in the system.
 *
 * Use named-field forms (every/daily/weekly/monthly) wherever possible.
 * The cron branch is an escape hatch only — for the genuinely irregular case.
 */

/** IANA timezone string, e.g. "America/Toronto" or "UTC". */
export type Tz = string;

/** Wall-clock time string in HH:MM or HH:MM:SS format, e.g. "03:00". */
export type TimeOfDay = string;

/** ISO day of the week. */
export type Weekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

/**
 * Duration string in ISO-8601 format (PT30S, PT5M, P1D) or short form
 * (30s, 5m, 1h, 2d). Parsed by parseDuration().
 */
export type Duration = string;

export type Schedule =
    | { every: Duration; jitter?: Duration }
    | { daily: TimeOfDay; tz?: Tz }
    | { weekly: { day: Weekday; at: TimeOfDay }; tz?: Tz }
    | { monthly: { day: number; at: TimeOfDay }; tz?: Tz }
    | { cron: string; tz?: Tz };
