# @jasonscharf/vaults

Secrets management for the Tern platform. Abstracts environment variables, Azure Key Vault, and in-process stores behind a single interface.

## Quick Start

```typescript
import { SecretsManager } from '@jasonscharf/vaults';

// Auto-detects backend:
//   - Azure Key Vault when AZURE_KEY_VAULT_URI is set
//   - process.env otherwise
const secrets = SecretsManager.fromEnvironment();

const dbPassword = await secrets.getRequired('DB_PASSWORD');            // throws if missing
const dbHost     = await secrets.getWithDefault('DB_HOST', 'localhost'); // falls back to default

await secrets.close();
```

## Providers

### EnvSecretsProvider

Reads from `process.env`. Default when no vault URI is configured.

```typescript
import { EnvSecretsProvider, SecretsManager } from '@jasonscharf/vaults';

const secrets = new SecretsManager(new EnvSecretsProvider());
```

### AzureKeyVaultProvider

Reads from Azure Key Vault via Workload Identity or environment credentials.

```typescript
import { AzureKeyVaultProvider, SecretsManager } from '@jasonscharf/vaults';

const secrets = new SecretsManager(
    new AzureKeyVaultProvider('https://my-vault.vault.azure.net/'),
);
```

Set `AZURE_KEY_VAULT_URI` to have `SecretsManager.fromEnvironment()` use this automatically.

### InMemorySecretsProvider

For tests — inject secrets directly without touching the environment.

```typescript
import { InMemorySecretsProvider, SecretsManager } from '@jasonscharf/vaults';

const secrets = new SecretsManager(
    new InMemorySecretsProvider({ DB_PASSWORD: 'test-secret' }),
);
```

### CachedSecretsProvider

Wraps any provider with TTL-based caching to avoid repeated remote calls.

```typescript
import { AzureKeyVaultProvider, CachedSecretsProvider, SecretsManager } from '@jasonscharf/vaults';

const secrets = new SecretsManager(
    new CachedSecretsProvider(
        new AzureKeyVaultProvider('https://my-vault.vault.azure.net/'),
        { ttlMs: 60_000, maxSize: 100 },
    ),
);
```

## Precedence Convention

Secrets resolve in this order (highest wins):

1. Vault (Azure Key Vault / custom provider)
2. `process.env`
3. Hardcoded default passed to `getWithDefault`

Never put production secrets in `process.env` when a vault is available. Use `getWithDefault` with a local dev default and let the vault override it in staging/prod.

## ISecretsProvider

Implement this interface to add your own backend:

```typescript
import type { ISecretsProvider } from '@jasonscharf/vaults';

class MyProvider implements ISecretsProvider {
    async get(key: string): Promise<string | undefined> {
        return myExternalStore.fetch(key);
    }
    async close(): Promise<void> { /* cleanup */ }
}
```

## Installation

```bash
yarn add @jasonscharf/vaults
# Azure Key Vault (optional):
yarn add @azure/identity @azure/keyvault-secrets
```

Published to GitHub Packages (`https://npm.pkg.github.com`).
