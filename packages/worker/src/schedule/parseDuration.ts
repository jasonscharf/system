/**
 * TRN-156: parseDuration — convert a duration string to milliseconds.
 *
 * Accepts two formats:
 *   ISO-8601: PT30S, PT5M, PT1H, P1D, PT1H30M, P1DT2H, etc.
 *   Short form: 30s, 5m, 1h, 2d
 *
 * Rejects anything else with an actionable error.
 */

// Short-form pattern: one or more <number><unit> groups, no spaces.
// Supported units: s (seconds), m (minutes), h (hours), d (days).
const SHORT_FORM_RE = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/;

// ISO-8601 duration pattern: P[nD][T[nH][nM][nS]]
// We only need precision to seconds for scheduling purposes.
const ISO_DURATION_RE = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Parse a duration string and return the equivalent number of milliseconds.
 *
 * @throws Error with an actionable message if the string is not a recognised
 *   ISO-8601 or short-form duration, or if the resulting duration is zero.
 */
export function parseDuration(s: string): number {
    if (!s || typeof s !== "string") {
        throw new Error(`parseDuration: expected a non-empty string, got ${JSON.stringify(s)}`);
    }

    const trimmed = s.trim();

    // Try ISO-8601 first (starts with "P").
    if (trimmed.startsWith("P")) {
        return _parseIso8601(trimmed);
    }

    // Try short form.
    return _parseShortForm(trimmed);
}

function _parseIso8601(s: string): number {
    const match = ISO_DURATION_RE.exec(s);
    if (!match) {
        throw new Error(
            `parseDuration: "${s}" is not a valid ISO-8601 duration. ` +
                `Expected format like PT30S, PT5M, P1D, P1DT2H30M. ` +
                `Only day/hour/minute/second components are supported.`,
        );
    }

    const days = match[1] ? Number(match[1]) : 0;
    const hours = match[2] ? Number(match[2]) : 0;
    const minutes = match[3] ? Number(match[3]) : 0;
    const seconds = match[4] ? Number(match[4]) : 0;

    const ms =
        days * MS_PER_DAY + hours * MS_PER_HOUR + minutes * MS_PER_MINUTE + seconds * MS_PER_SECOND;

    if (ms === 0) {
        throw new Error(
            `parseDuration: "${s}" resolves to zero milliseconds. ` +
                `A schedule duration must be at least 1 second.`,
        );
    }

    return ms;
}

function _parseShortForm(s: string): number {
    // Reject strings that look like they tried ISO but got it wrong.
    if (s.includes("P") || s.includes("T")) {
        throw new Error(
            `parseDuration: "${s}" looks like a malformed ISO-8601 duration. ` +
                `Start with "P" for ISO-8601 (e.g. PT30S) or use short form (e.g. 30s).`,
        );
    }

    const match = SHORT_FORM_RE.exec(s);

    // The regex can match the empty string; reject it explicitly.
    if (!match || s === "") {
        throw new Error(
            `parseDuration: "${s}" is not a recognised duration. ` +
                `Use ISO-8601 (PT30S, PT5M, P1D) or short form (30s, 5m, 1h, 2d).`,
        );
    }

    const days = match[1] ? Number(match[1]) : 0;
    const hours = match[2] ? Number(match[2]) : 0;
    const minutes = match[3] ? Number(match[3]) : 0;
    const seconds = match[4] ? Number(match[4]) : 0;

    const ms =
        days * MS_PER_DAY + hours * MS_PER_HOUR + minutes * MS_PER_MINUTE + seconds * MS_PER_SECOND;

    if (ms === 0) {
        throw new Error(
            `parseDuration: "${s}" resolves to zero milliseconds. ` +
                `A schedule duration must be at least 1 second.`,
        );
    }

    return ms;
}
