import type { ISessionStore } from './ISessionStore.js';


interface Entry {
    value:  string;
    expiry: number;
}

export class MemorySessionStore implements ISessionStore {
    private readonly _store = new Map<string, Entry>();

    async set(key: string, value: string, ttlSeconds: number): Promise<void> {
        this._store.set(key, { value, expiry: Date.now() + ttlSeconds * 1000 });
    }

    async get(key: string): Promise<string | null> {
        const entry = this._store.get(key);
        if (!entry) { return null; }
        if (Date.now() >= entry.expiry) {
            this._store.delete(key);
            return null;
        }
        return entry.value;
    }

    async del(key: string): Promise<void> {
        this._store.delete(key);
    }

    clear(): void {
        this._store.clear();
    }
}
