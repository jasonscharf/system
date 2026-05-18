import type { ISecretsProvider } from './ISecretsProvider.js';


interface CacheEntry {
    value:     string | null;
    expiresAt: number;
}

export interface CacheOptions {
    /** How long to cache a successful result, in milliseconds. Default: 5 minutes. */
    ttlMs?: number;
    /** How long to cache a null (not-found) result. Default: 60 seconds. */
    nullTtlMs?: number;
}

/**
 * Wraps any ISecretsProvider with a time-based in-process cache.
 *
 * This avoids hammering the upstream vault on every request and respects
 * Azure Key Vault's throttle limits (typically 2000 operations/10 s).
 */
export class CachedSecretsProvider implements ISecretsProvider {
    private readonly _inner:     ISecretsProvider;
    private readonly _ttl:       number;
    private readonly _nullTtl:   number;
    private readonly _cache      = new Map<string, CacheEntry>();

    constructor(inner: ISecretsProvider, options: CacheOptions = {}) {
        this._inner   = inner;
        this._ttl     = options.ttlMs    ?? 5 * 60 * 1000;
        this._nullTtl = options.nullTtlMs ?? 60 * 1000;
    }

    async get(key: string): Promise<string | null> {
        const now    = Date.now();
        const cached = this._cache.get(key);

        if (cached && now < cached.expiresAt) {
            return cached.value;
        }

        const value = await this._inner.get(key);
        this._cache.set(key, {
            value,
            expiresAt: now + (value !== null ? this._ttl : this._nullTtl),
        });
        return value;
    }

    async getRequired(key: string): Promise<string> {
        const value = await this.get(key);
        if (value === null) {
            throw new Error(`Required secret '${key}' not found`);
        }
        return value;
    }

    invalidate(key?: string): void {
        if (key) {
            this._cache.delete(key);
        } else {
            this._cache.clear();
        }
    }

    async close(): Promise<void> {
        this._cache.clear();
        await this._inner.close?.();
    }
}
