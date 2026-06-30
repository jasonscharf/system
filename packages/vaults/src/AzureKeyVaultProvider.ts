import type { ISecretsProvider } from "./ISecretsProvider.js";

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
 *   SYS_PG_PASSWORD       →  sys-pg-password
 *
 * The `SYS_` env prefix lowercases to the `sys-` vault prefix verbatim; the two
 * are the same namespace spelled for two transports (env vars use underscores,
 * Azure KV names use hyphens). This is the single naming convention across the
 * stack.
 *
 * Azure KV secret names allow only [a-zA-Z0-9-] and max 127 characters.
 *
 * Per-secret environment fallback
 * ───────────────────────────────
 * A key that is NOT present in the vault (Azure returns SecretNotFound / 404)
 * falls back to the matching `process.env[key]` before resolving to null. This
 * lets non-sensitive runtime config (db host/user/database, redis url, etc.)
 * live in a plain ConfigMap / env block while only the actual secrets are
 * stored in the vault — the caller passes one key (`SYS_PG_HOST`) and gets the
 * vault value when present, otherwise the env value, otherwise null. Auth /
 * network errors are still rethrown so a misconfigured vault fails loudly
 * rather than silently degrading to env.
 */
export class AzureKeyVaultProvider implements ISecretsProvider {
    private readonly _vaultUri: string;
    private _client: SecretClientLike | null = null;

    constructor(vaultUri: string) {
        this._vaultUri = vaultUri.replace(/\/$/, "");
    }

    private async _getClient(): Promise<SecretClientLike> {
        if (this._client) {
            return this._client;
        }

        const [{ SecretClient }, { DefaultAzureCredential }] = await Promise.all([
            import("@azure/keyvault-secrets"),
            import("@azure/identity"),
        ]);

        const cred: AzureCredential = new DefaultAzureCredential();
        this._client = new SecretClient(
            this._vaultUri,
            cred as Parameters<typeof SecretClient.prototype.getSecret>[0] extends never
                ? never
                : never,
        );

        // TypeScript can't narrow the exact SDK type, but DefaultAzureCredential
        // satisfies the TokenCredential interface SecretClient requires at runtime.
        this._client = new (SecretClient as new (uri: string, cred: object) => SecretClientLike)(
            this._vaultUri,
            cred,
        );
        return this._client;
    }

    async get(key: string): Promise<string | null> {
        const client = await this._getClient();
        const secretName = this._toVaultName(key);

        try {
            const secret = await client.getSecret(secretName);
            return secret.value ?? this._envFallback(key);
        } catch (err: unknown) {
            const code =
                (err as { code?: string; statusCode?: number }).code ??
                String((err as { statusCode?: number }).statusCode);
            if (code === "SecretNotFound" || code === "404") {
                // Not in the vault — fall back to the matching env var so plain
                // ConfigMap config resolves through the same call as real secrets.
                return this._envFallback(key);
            }
            throw err;
        }
    }

    /** The raw env var for a key, or null when it too is unset. */
    private _envFallback(key: string): string | null {
        return process.env[key] ?? null;
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
        // The env name and the vault name are the same convention in two
        // spellings: SYS_FOO (env, underscores) <-> sys-foo (vault, hyphens).
        // Just lowercase and swap underscores for hyphens; do NOT rewrite the
        // SYS_ prefix.
        return key.toLowerCase().replace(/_/g, "-");
    }
}
