import type { ISecretsProvider } from './ISecretsProvider.js';


// ── Minimal type surfaces so we don't hard-import the Azure SDKs at module ────
// load time (they're heavy and not always present). Dynamic import handles the ─
// rest.                                                                         ─

type AzureCredential = object;

type SecretClientLike = {
    getSecret(name: string): Promise<{ value?: string }>;
};

/**
 * Reads secrets from Azure Key Vault.
 *
 * Authentication is handled by `DefaultAzureCredential` from `@azure/identity`,
 * which tries (in order):
 *   1. Environment variables (AZURE_TENANT_ID + AZURE_CLIENT_ID + AZURE_CLIENT_SECRET)
 *   2. Workload Identity (k8s + Azure AD — preferred in staging/prod)
 *   3. Managed Identity (Azure-hosted VMs, App Service, etc.)
 *   4. Azure CLI / VS Code credentials (developer machines)
 *
 * Key naming convention
 * ─────────────────────
 * Environment variable names (e.g. `GOOGLE_CLIENT_SECRET`) are mapped to Azure
 * Key Vault secret names by lowercasing and replacing underscores with hyphens:
 *   GOOGLE_CLIENT_SECRET  →  google-client-secret
 *   TERN_PG_PASSWORD      →  tern-pg-password
 *
 * Azure KV secret names allow only [a-zA-Z0-9-] and max 127 characters.
 */
export class AzureKeyVaultProvider implements ISecretsProvider {
    private readonly _vaultUri: string;
    private _client: SecretClientLike | null = null;

    constructor(vaultUri: string) {
        this._vaultUri = vaultUri.replace(/\/$/, '');
    }

    private async _getClient(): Promise<SecretClientLike> {
        if (this._client) { return this._client; }

        const [{ SecretClient }, { DefaultAzureCredential }] = await Promise.all([
            import('@azure/keyvault-secrets'),
            import('@azure/identity'),
        ]);

        const cred: AzureCredential = new DefaultAzureCredential();
        this._client = new SecretClient(this._vaultUri, cred as Parameters<typeof SecretClient.prototype.getSecret>[0] extends never ? never : never);

        // TypeScript can't narrow the exact SDK type, but DefaultAzureCredential
        // satisfies the TokenCredential interface SecretClient requires at runtime.
        this._client = new (SecretClient as new (uri: string, cred: object) => SecretClientLike)(
            this._vaultUri,
            cred,
        );
        return this._client;
    }

    async get(key: string): Promise<string | null> {
        const client     = await this._getClient();
        const secretName = this._toVaultName(key);

        try {
            const secret = await client.getSecret(secretName);
            return secret.value ?? null;
        } catch (err: unknown) {
            const code = (err as { code?: string; statusCode?: number }).code
                ?? String((err as { statusCode?: number }).statusCode);
            if (code === 'SecretNotFound' || code === '404') { return null; }
            throw err;
        }
    }

    async getRequired(key: string): Promise<string> {
        const value = await this.get(key);
        if (value === null) {
            throw new Error(
                `Secret '${key}' (vault name '${this._toVaultName(key)}') not found in Azure Key Vault ${this._vaultUri}`,
            );
        }
        return value;
    }

    private _toVaultName(key: string): string {
        return key.toLowerCase().replace(/_/g, '-');
    }
}
