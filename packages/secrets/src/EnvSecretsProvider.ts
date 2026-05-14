import type { ISecretsProvider } from './ISecretsProvider.js';


/**
 * Reads secrets directly from process.env.
 * Suitable for local development and as a fallback in test environments.
 */
export class EnvSecretsProvider implements ISecretsProvider {
    async get(key: string): Promise<string | null> {
        return process.env[key] ?? null;
    }

    async getRequired(key: string): Promise<string> {
        const value = process.env[key];
        if (value === undefined || value === '') {
            throw new Error(`Required environment variable '${key}' is not set`);
        }
        return value;
    }
}
