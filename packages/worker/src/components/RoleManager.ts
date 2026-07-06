import { hostname } from "node:os";
import { resolveService } from "@jasonscharf/core";
import { DataSource } from "@jasonscharf/data";
import { FlowComponent, type FlowComponentOptions, type FlowPort } from "@jasonscharf/flow";
import type { Knex } from "knex";
import {
    ROLE_DEFAULT_SLOTS,
    ROLE_DEFAULT_TTL_MS,
    ROLE_HEARTBEAT_DIVISOR,
    ROLE_HOLDER_NONCE_BYTES,
} from "../config.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/** One role the manager is willing to hold. */
export interface WillingRole {
    role: string;
    /** Number of concurrent holders allowed. Defaults to ROLE_DEFAULT_SLOTS. */
    slots?: number;
}

/** Emitted on outRoleChanged whenever a role is gained or lost. */
export interface RoleChangeEvent {
    role: string;
    held: boolean;
}

export interface RoleManagerOptions extends FlowComponentOptions {
    /** Database connection. Resolved from the container (DataSource) when omitted. */
    knex?: Knex;
    roles: WillingRole[];
    /** Lease TTL in ms. Defaults to ROLE_DEFAULT_TTL_MS. */
    ttlMs?: number;
    /**
     * Injectable clock — returns the current time. Defaults to () => new Date().
     * Override in tests to advance time deterministically without real sleeps.
     */
    now?: () => Date;
}

// ── Internal lease key ────────────────────────────────────────────────────────

/** Stable key for tracking which (role, slot) pairs we currently hold. */
function leaseKey(role: string, slot: number): string {
    return `${role}:${slot}`;
}

/** Generate a cryptographically random hex nonce of the given byte count. */
function randomNonce(bytes: number): string {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    return Array.from(buf)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

// ── RoleManager ───────────────────────────────────────────────────────────────

/**
 * Per-process FlowComponent that acquires and renews named role leases backed
 * by the sys_role_lease table.
 *
 * - Runs an acquire/renew tick every heartbeatMs (= ttlMs / ROLE_HEARTBEAT_DIVISOR).
 * - Exposes holds(role) for O(1) in-process reads.
 * - Emits outRoleChanged on every gain or loss.
 * - Releases held slots on dispose for fast handover.
 */
export class RoleManager extends FlowComponent {
    /** Emits RoleChangeEvent whenever a role is gained or lost. */
    readonly outRoleChanged: FlowPort<RoleChangeEvent>;

    private readonly _knex: Knex;
    private readonly _roles: WillingRole[];
    private readonly _ttlMs: number;
    private readonly _heartbeatMs: number;
    private readonly _holderId: string;
    private readonly _now: () => Date;

    /** Set of "role:slot" keys this process currently holds. */
    private readonly _held = new Set<string>();

    /** Active timer handle — cleared on dispose. */
    private _timer: ReturnType<typeof setInterval> | undefined;

    constructor(options: RoleManagerOptions) {
        super(options);

        this.outRoleChanged = this.addPort<RoleChangeEvent>("outRoleChanged", "out");

        this._knex = options.knex ?? resolveService(DataSource).knex;
        this._roles = options.roles;
        this._ttlMs = options.ttlMs ?? ROLE_DEFAULT_TTL_MS;
        this._heartbeatMs = Math.floor(this._ttlMs / ROLE_HEARTBEAT_DIVISOR);
        this._now = options.now ?? (() => new Date());

        // Stable holder_id for this process instance.
        const nonce = randomNonce(ROLE_HOLDER_NONCE_BYTES);
        this._holderId = `${hostname()}-${process.pid}-${nonce}`;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Returns true when this process currently holds at least one slot of the
     * given role. O(1) — reads the in-memory held set.
     */
    holds(role: string): boolean {
        for (const key of this._held) {
            if (key.startsWith(`${role}:`)) {
                return true;
            }
        }
        return false;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    protected override async onInit(): Promise<void> {
        // Run one tick immediately so the process acquires leases before the
        // first heartbeat interval fires.
        await this._tick();

        this._timer = setInterval(() => {
            const tickPromise = this._tick();
            tickPromise.catch((err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err);
                // Log via console until the worker has a structured logger.
                console.error(`[RoleManager] tick error: ${msg}`);
            });
        }, this._heartbeatMs);
    }

    protected override async onDispose(): Promise<void> {
        if (this._timer !== undefined) {
            clearInterval(this._timer);
            this._timer = undefined;
        }

        // Release all currently-held slots for fast handover — don't force
        // waiters to sit out the full TTL on a clean shutdown.
        for (const key of this._held) {
            const colonIdx = key.lastIndexOf(":");
            const role = key.slice(0, colonIdx);
            const slot = Number(key.slice(colonIdx + 1));
            await this._release(role, slot);
        }
        this._held.clear();
    }

    // ── Tick ──────────────────────────────────────────────────────────────────

    private async _tick(): Promise<void> {
        for (const config of this._roles) {
            const slotCount = config.slots ?? ROLE_DEFAULT_SLOTS;
            await this._processRole(config.role, slotCount);
        }
    }

    /**
     * Process all slots for one role.
     *
     * A process may hold at most one slot per role. If we already hold a slot
     * for this role we renew it (and skip the others). If we hold nothing we
     * try each slot in order and stop after the first successful claim.
     */
    private async _processRole(role: string, slotCount: number): Promise<void> {
        // Find the slot we currently hold for this role, if any.
        let heldSlot: number | undefined;
        for (let s = 0; s < slotCount; s++) {
            if (this._held.has(leaseKey(role, s))) {
                heldSlot = s;
                break;
            }
        }

        if (heldSlot !== undefined) {
            // We hold a slot — renew it and skip the rest.
            await this._renew(role, heldSlot, leaseKey(role, heldSlot));
            return;
        }

        // We hold nothing — try each slot until one claim succeeds.
        for (let slot = 0; slot < slotCount; slot++) {
            const key = leaseKey(role, slot);
            const before = this._held.has(key);
            await this._acquire(role, slot, key);
            if (!before && this._held.has(key)) {
                // Successfully claimed — don't take more slots.
                break;
            }
        }
    }

    private async _renew(role: string, slot: number, key: string): Promise<void> {
        const now = this._now();
        const expiresAt = new Date(now.getTime() + this._ttlMs);

        let updated = 0;
        await this._knex.transaction(async (trx) => {
            updated = await trx("sys_role_lease")
                .where({ role, slot, holder_id: this._holderId })
                .update({
                    expires_at: expiresAt,
                });
        });

        if (updated === 0) {
            // We lost the lease (evicted or expired under us).
            this._held.delete(key);
            this.outRoleChanged.put({ role, held: false });
        }
    }

    private async _acquire(role: string, slot: number, key: string): Promise<void> {
        const now = this._now();
        const expiresAt = new Date(now.getTime() + this._ttlMs);

        await this._knex.transaction(async (trx) => {
            // Ensure the row exists (upsert: insert if absent, ignore if present).
            await this._upsertLeaseRow(trx, role, slot);

            // Try to claim the slot: succeeds only if it is free or expired.
            const updated: number = await trx("sys_role_lease")
                .where({ role, slot })
                .where((qb) => {
                    qb.whereNull("holder_id").orWhere("expires_at", "<", now);
                })
                .update({
                    holder_id: this._holderId,
                    acquired_at: now,
                    expires_at: expiresAt,
                });

            if (updated > 0) {
                this._held.add(key);
                this.outRoleChanged.put({ role, held: true });
            }
        });
    }

    private async _release(role: string, slot: number): Promise<void> {
        await this._knex.transaction(async (trx) => {
            await trx("sys_role_lease").where({ role, slot, holder_id: this._holderId }).update({
                holder_id: null,
                acquired_at: null,
            });
        });
    }

    /**
     * Insert the lease row if it does not already exist.
     *
     * SQLite and Postgres both support INSERT OR IGNORE / INSERT ... ON CONFLICT
     * DO NOTHING, but the syntax differs. Knex's `.onConflict().ignore()` works
     * for both when the primary key is (role, slot).
     *
     * expires_at is set to the epoch so the row is immediately claimable on
     * first insert — no special "unborn" state needed.
     */
    private async _upsertLeaseRow(
        trx: Knex.Transaction,
        role: string,
        slot: number,
    ): Promise<void> {
        await trx("sys_role_lease")
            .insert({
                role,
                slot,
                holder_id: null,
                acquired_at: null,
                expires_at: new Date(0),
                meta: null,
            })
            .onConflict(["role", "slot"])
            .ignore();
    }
}
