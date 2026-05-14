import type { ISecretsProvider } from './ISecretsProvider.js';
import { EnvSecretsProvider } from './EnvSecretsProvider.js';
import { AzureKeyVaultProvider } from './AzureKeyVaultProvider.js';
import { CachedSecretsProvider } from './CachedSecretsProvider.js';


/**
 * SecretsManager is the single entry point for secret retrieval.
 *
 * Provider selection (in priority order):
 *
 *   1. AZURE_KEY_VAULT_URI is set → AzureKeyVaultProvider (wrapped in a 5 min cache)
 *   2. Fallback                   → EnvSecretsProvider (reads process.env directly)
 *
 * This means:
 *   - Local dev:         set secrets as environment variables (or .env.local)
 *   - Staging / prod:    set AZURE_KEY_VAULT_URI; Workload Identity provides auth
 *
 * Usage
 * ─────
 *   // At application startup:
 *   const secrets = SecretsManager.fromEnvironment();
 *   const dbPass  = await secrets.getRequired('TERN_PG_PASSWORD');
 *
 *   // Or inject a specific provider (e.g. in tests):
 *   const secrets = new SecretsManager(new InMemorySecretsProvider({ FOO: 'bar' }));
 */
export class SecretsManager {
    private readonly _provider: ISecretsProvider;

    constructor(provider: ISecretsProvider) {
        this._provider = provider;
    }

    get(key: string): Promise<string | null> {
        return this._provider.get(key);
    }

    getRequired(key: string): Promise<string> {
        return this._provider.getRequired(key);
    }

    async getWithDefault(key: string, defaultValue: string): Promise<string> {
        return (await this._provider.get(key)) ?? defaultValue;
    }

    async close(): Promise<void> {
        await this._provider.close?.();
    }

    /**
     * Build a SecretsManager from the runtime environment.
     *
     * Set AZURE_KEY_VAULT_URI to use Azure Key Vault (staging / prod).
     * Leave it unset to fall back to EnvSecretsProvider (local dev).
     */
    static fromEnvironment(): SecretsManager {
        const vaultUri = process.env['AZURE_KEY_VAULT_URI'];

        if (vaultUri) {
            console.log(`[secrets] Using Azure Key Vault: ${vaultUri}`);
            return new SecretsManager(
                new CachedSecretsProvider(
                    new AzureKeyVaultProvider(vaultUri),
                    { ttlMs: 5 * 60 * 1000, nullTtlMs: 30 * 1000 },
                ),
            );
        }

        console.log('[secrets] Using environment variable secrets (local/dev mode)');
        return new SecretsManager(new EnvSecretsProvider());
    }
}
