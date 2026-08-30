import { getLog } from "@jasonscharf/core";
import { AzureKeyVaultProvider } from "./AzureKeyVaultProvider.js";
import { CachedSecretsProvider } from "./CachedSecretsProvider.js";
import { EnvSecretsProvider } from "./EnvSecretsProvider.js";
import { GcpSecretManagerProvider } from "./GcpSecretManagerProvider.js";
import type { ISecretsProvider } from "./ISecretsProvider.js";

const log = getLog("sys:vaults:secrets");

/**
 * SecretsManager is the single entry point for secret retrieval.
 *
 * Provider selection (in priority order):
 *
 *   1. AZURE_KEY_VAULT_URI is set  → AzureKeyVaultProvider (5 min cache)
 *   2. GCP_SECRETS_PROJECT is set  → GcpSecretManagerProvider (5 min cache)
 *   3. Fallback                    → EnvSecretsProvider (reads process.env directly)
 *
 * This means:
 *   - Local dev:      set secrets as environment variables (or .env.local)
 *   - Azure staging:  set AZURE_KEY_VAULT_URI; Workload Identity provides auth
 *   - GCP prod:       set GCP_SECRETS_PROJECT; the node service account provides auth
 *
 * Both cloud branches are chosen by an explicit variable naming the store, never
 * by sniffing which cloud this happens to be running on. Unset means env, which
 * is what a workstation and a test both want.
 *
 * Usage
 * ─────
 *   // At application startup:
 *   const secrets = SecretsManager.fromEnvironment();
 *   const dbPass  = await secrets.getRequired('SYS_PG_PASSWORD');
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
     * Set AZURE_KEY_VAULT_URI for Azure Key Vault, or GCP_SECRETS_PROJECT for
     * GCP Secret Manager. Leave both unset to fall back to EnvSecretsProvider
     * (local dev, tests).
     */
    static fromEnvironment(): SecretsManager {
        const vaultUri = process.env.AZURE_KEY_VAULT_URI;
        const gcpProject = process.env.GCP_SECRETS_PROJECT;

        if (vaultUri && gcpProject) {
            // Two stores means two answers for one key and no way to tell which
            // one a value came from. Refuse rather than pick.
            throw new Error(
                "AZURE_KEY_VAULT_URI and GCP_SECRETS_PROJECT are both set. " +
                    "Exactly one secret store may be configured.",
            );
        }

        if (gcpProject) {
            log.info("source-gcp-secret-manager", "Using GCP Secret Manager", { gcpProject });
            return new SecretsManager(
                new CachedSecretsProvider(new GcpSecretManagerProvider(gcpProject), {
                    ttlMs: 5 * 60 * 1000,
                    nullTtlMs: 30 * 1000,
                }),
            );
        }

        if (vaultUri) {
            log.info("source-key-vault", "Using Azure Key Vault", { vaultUri });
            return new SecretsManager(
                new CachedSecretsProvider(new AzureKeyVaultProvider(vaultUri), {
                    ttlMs: 5 * 60 * 1000,
                    nullTtlMs: 30 * 1000,
                }),
            );
        }

        log.info("source-env", "Using environment variable secrets");
        return new SecretsManager(new EnvSecretsProvider());
    }
}
