import type { ISecretsProvider } from "./ISecretsProvider.js";

/**
 * In-memory secrets store backed by a plain Map.
 * Use in tests and local-dev stubs — never in production.
 */
export class InMemorySecretsProvider implements ISecretsProvider {
    private readonly _store: Map<string, string>;

    constructor(initial: Record<string, string> = {}) {
        this._store = new Map(Object.entries(initial));
    }

    set(key: string, value: string): this {
        this._store.set(key, value);
        return this;
    }

    delete(key: string): this {
        this._store.delete(key);
        return this;
    }

    async get(key: string): Promise<string | null> {
        return this._store.get(key) ?? null;
    }

    async getRequired(key: string): Promise<string> {
        const value = this._store.get(key);
        if (value === undefined) {
            throw new Error(`Secret '${key}' not found in InMemorySecretsProvider`);
        }
        return value;
    }
}
