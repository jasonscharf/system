/**
 * Default configuration constants for the worker package.
 *
 * All timing values are in milliseconds unless suffixed otherwise.
 * Group constants by concern so callers can import only what they need.
 */

// ── JobScheduler defaults ─────────────────────────────────────────────────────

/**
 * How often the scheduler polls for due jobs, in milliseconds.
 * Short enough for timely firing; long enough to avoid hammering the DB.
 */
export const SCHEDULER_TICK_INTERVAL_MS = 5_000;

/**
 * Maximum number of due jobs processed in a single tick.
 * Keeps each tick bounded; a backlog drains across successive ticks.
 */
export const SCHEDULER_BATCH_SIZE = 50;

// ── RoleManager defaults ──────────────────────────────────────────────────────

/** Default lease TTL. A process must renew within this window or lose its slot. */
export const ROLE_DEFAULT_TTL_MS = 30_000;

/**
 * Heartbeat interval as a fraction of the TTL.
 * Renewing at TTL/3 gives two missed beats before the lease expires.
 */
export const ROLE_HEARTBEAT_DIVISOR = 3;

/** Default cap (number of concurrent holders) for a role. */
export const ROLE_DEFAULT_SLOTS = 1;

/** Nonce length (bytes) used when building the holder_id. */
export const ROLE_HOLDER_NONCE_BYTES = 4;
