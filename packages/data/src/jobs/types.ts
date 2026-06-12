/**
 * TRN-154: TypeScript row interfaces for the Jobs & Roles control-plane tables.
 *
 * These are plain data shapes — no runtime logic. Field names are camelCase
 * versions of the snake_case column names in the database.
 */

// ── sys_role_lease ────────────────────────────────────────────────────────────

export interface SysRoleLease {
    role: string;
    slot: number;
    holderId: string | null;
    acquiredAt: Date | null;
    expiresAt: Date;
    meta: unknown | null;
}

// ── sys_job ───────────────────────────────────────────────────────────────────

export interface SysJob {
    id: string;
    schedule: unknown;
    handler: string;
    requiresRole: string | null;
    enabled: boolean;
    nextRunAt: Date;
    maxAttempts: number;
    meta: unknown | null;
}

// ── sys_job_run ───────────────────────────────────────────────────────────────

export type JobRunStatus = "pending" | "running" | "succeeded" | "failed" | "dead";

export interface SysJobRun {
    id: string;
    jobId: string;
    scheduledFor: Date;
    status: JobRunStatus;
    attempt: number;
    claimedBy: string | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    error: string | null;
}
