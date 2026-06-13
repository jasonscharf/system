import { makeUri, NS_CORE } from "@jasonscharf/core";
import {
    AUTH_THROTTLE_MAX_PER_IDENTITY,
    AUTH_THROTTLE_MAX_PER_IP,
    AUTH_THROTTLE_WINDOW_SECS,
} from "../constants.js";
import type { ISessionStore } from "./ISessionStore.js";

export interface AuthThrottleOptions {
    /** Max auth hits per IP within the window. Default: AUTH_THROTTLE_MAX_PER_IP. */
    maxPerIp?: number;
    /** Max auth hits per identity (e.g. provider+state) within the window. Default: AUTH_THROTTLE_MAX_PER_IDENTITY. */
    maxPerIdentity?: number;
    /** Sliding-window length in seconds. Default: AUTH_THROTTLE_WINDOW_SECS. */
    windowSecs?: number;
}

interface WindowEntry {
    count: number;
    /** Epoch ms at which the current window started. */
    start: number;
}

/**
 * Fixed-window auth throttle backed by an ISessionStore (Redis in production,
 * in-memory for tests). Both the per-IP and per-identity dimensions are checked.
 *
 * The store only exposes get/set/del, so a fixed window is used: the first hit
 * in a window stamps `start` and sets the entry TTL to the window length; the
 * entry then expires on its own. This is intentionally simple and correct for
 * the store contract — it does not require atomic INCR.
 *
 * Failure mode: FAIL-OPEN. If the backing store throws (e.g. Redis is down),
 * `check` returns allowed=true. Bricking all logins because a cache is offline
 * is a worse outcome than briefly losing throttle coverage; the DB-fallback DoS
 * vector it guards is itself also gated by the negative cache and session TTLs.
 */
export class AuthThrottle {
    private readonly _store: ISessionStore;
    private readonly _maxPerIp: number;
    private readonly _maxPerIdentity: number;
    private readonly _windowSecs: number;

    constructor(store: ISessionStore, options: AuthThrottleOptions = {}) {
        this._store = store;
        this._maxPerIp = options.maxPerIp ?? AUTH_THROTTLE_MAX_PER_IP;
        this._maxPerIdentity = options.maxPerIdentity ?? AUTH_THROTTLE_MAX_PER_IDENTITY;
        this._windowSecs = options.windowSecs ?? AUTH_THROTTLE_WINDOW_SECS;
    }

    /**
     * Records one auth hit and reports whether the caller is now over a limit.
     * `ip` is always checked; `identity` (e.g. `provider:state`) is checked when
     * provided. Returns `allowed=false` once either dimension exceeds its max.
     */
    async check(args: { ip: string | null; identity?: string | null }): Promise<{
        allowed: boolean;
        retryAfterSecs: number;
    }> {
        const checks: Array<Promise<boolean>> = [];
        if (args.ip) {
            checks.push(this._bump(`ip:${args.ip}`, this._maxPerIp));
        }
        if (args.identity) {
            checks.push(this._bump(`id:${args.identity}`, this._maxPerIdentity));
        }
        const results = await Promise.all(checks);
        const allowed = results.every((ok) => ok);
        return { allowed, retryAfterSecs: allowed ? 0 : this._windowSecs };
    }

    private _key(dimension: string): string {
        return makeUri(NS_CORE, "auth", "throttle", dimension);
    }

    /**
     * Increments the counter for one dimension and returns whether it is still
     * within `max`. Fail-open on any store error.
     */
    private async _bump(dimension: string, max: number): Promise<boolean> {
        const key = this._key(dimension);
        try {
            const now = Date.now();
            const raw = await this._store.get(key);
            let entry: WindowEntry;
            if (raw) {
                const parsed = JSON.parse(raw) as WindowEntry;
                const expired = now - parsed.start >= this._windowSecs * 1000;
                entry = expired
                    ? { count: 1, start: now }
                    : { count: parsed.count + 1, start: parsed.start };
            } else {
                entry = { count: 1, start: now };
            }
            // TTL is measured from the window start so the entry expires with the window.
            const elapsedSecs = Math.floor((now - entry.start) / 1000);
            const ttl = Math.max(1, this._windowSecs - elapsedSecs);
            await this._store.set(key, JSON.stringify(entry), ttl);
            return entry.count <= max;
        } catch {
            // Fail-open: never block auth because the throttle store is unavailable.
            return true;
        }
    }
}
