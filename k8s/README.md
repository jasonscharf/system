# Tern Kubernetes Configuration

Kustomize-based k8s manifests for **local**, **staging**, and **prod** deployments.

```
k8s/
├── base/                     shared resources (server, web, redis)
└── overlays/
    ├── local/                SQLite + in-process secrets (placeholder OAuth)
    ├── staging/              PostgreSQL + Redis PVC + Azure Key Vault
    └── prod/                 PostgreSQL + Redis PVC + Azure Key Vault + HPA + PDB
```

## Secrets Architecture

| Environment | Where secrets live |
|-------------|-------------------|
| **local** | k8s Secrets (placeholder values — safe to commit) |
| **staging** | Azure Key Vault (`tern-staging`) — vault URI only in k8s |
| **prod** | Azure Key Vault (`tern-prod`) — vault URI only in k8s |

In staging/prod the server pod uses **Azure Workload Identity** — a federated service-account token — so no secret credentials are ever stored in k8s. The only k8s ConfigMap value needed is `AZURE_KEY_VAULT_URI`.

Secret keys in Azure Key Vault follow the naming convention `env-var-name → lowercase-with-hyphens`:

| Env var | Vault secret name |
|---------|-------------------|
| `SYS_AUTH_GOOGLE_CLIENT_ID` | `sys-auth-google-client-id` |
| `SYS_AUTH_GOOGLE_CLIENT_SECRET` | `sys-auth-google-client-secret` |
| `SYS_AUTH_GITHUB_CLIENT_ID` | `sys-auth-github-client-id` |
| `SYS_AUTH_GITHUB_CLIENT_SECRET` | `sys-auth-github-client-secret` |
| `SYS_POSTGRES_PASSWORD` | `sys-postgres-password` |
| `SYS_REDIS_URL` | `sys-redis-url` (optional) |

## Quick Start

### Prerequisites

```sh
# Kustomize v5+ (or use kubectl --kustomize)
brew install kustomize

# For local: minikube or kind
brew install minikube
minikube start
```

### Local

```sh
# 1. Build images locally
docker build --target server -t tern/server:local .
docker build --target web    -t tern/web:local    .

# 2. Load into minikube
minikube image load tern/server:local
minikube image load tern/web:local

# 3. Apply
kubectl apply -k k8s/overlays/local

# 4. Open in browser
minikube service web -n tern-local
```

The web NodePort is fixed at 30080:
```sh
open http://$(minikube ip):30080
```

For local dev **outside** k8s (plain Vite + node), copy `.env.local.example`:
```sh
cp packages/sandbox-web/.env.local.example packages/sandbox-web/.env.local
```

### Staging

1. **One-time Azure setup** (see `overlays/staging/service-account.yaml` for full instructions):
   ```sh
   # Enable Workload Identity on the AKS cluster
   az aks update --resource-group <rg> --name <cluster> \
     --enable-oidc-issuer --enable-workload-identity

   # Create managed identity and federated credential
   az identity create --name tern-staging --resource-group <rg>
   az identity federated-credential create \
     --name tern-staging --identity-name tern-staging --resource-group <rg> \
     --issuer $(az aks show -g <rg> -n <cluster> \
                  --query "oidcIssuerProfile.issuerUrl" -o tsv) \
     --subject "system:serviceaccount:tern-staging:tern-server" \
     --audience api://AzureADTokenExchange

   # Grant Key Vault access
   az keyvault set-policy --name tern-staging \
     --object-id $(az identity show --name tern-staging -g <rg> \
                     --query principalId -o tsv) \
     --secret-permissions get list
   ```

2. **Populate vault secrets**:
   ```sh
   az keyvault secret set --vault-name tern-staging --name google-client-id     --value "<id>"
   az keyvault secret set --vault-name tern-staging --name google-client-secret --value "<secret>"
   az keyvault secret set --vault-name tern-staging --name github-client-id     --value "<id>"
   az keyvault secret set --vault-name tern-staging --name github-client-secret --value "<secret>"
   az keyvault secret set --vault-name tern-staging --name tern-pg-password     --value "<password>"
   ```

3. **Create the postgres k8s Secret** (only the DB init password — server gets it from vault):
   ```sh
   kubectl create namespace tern-staging
   kubectl create secret generic postgres-secret \
     --namespace tern-staging \
     --from-literal=POSTGRES_PASSWORD=<password>
   ```

4. **Patch the managed identity client ID**:
   ```sh
   CLIENT_ID=$(az identity show --name tern-staging -g <rg> --query clientId -o tsv)
   sed -i "s/<MANAGED_IDENTITY_CLIENT_ID>/$CLIENT_ID/" k8s/overlays/staging/service-account.yaml
   ```

5. **Deploy**:
   ```sh
   kubectl apply -k k8s/overlays/staging
   ```

### Prod

Same flow as staging with:
- Vault name: `tern-prod`
- Namespace: `tern-prod`
- Overlay: `k8s/overlays/prod`
- Update `AUTH_BASE_URL` and hostname in `overlays/prod/kustomization.yaml` and `ingress.yaml`

```sh
kubectl create namespace tern-prod
kubectl create secret generic postgres-secret \
  --namespace tern-prod \
  --from-literal=POSTGRES_PASSWORD=<strong-password>
kubectl apply -k k8s/overlays/prod
```

## Image Tags

CI builds and pushes on every merge to `main`:

| Image | GHCR path |
|-------|-----------|
| Server | `ghcr.io/<owner>/system-server:latest` |
| Web | `ghcr.io/<owner>/system-web:latest` |

Pin to a specific SHA in production by updating `images[].newTag` in the overlay's `kustomization.yaml`.

## Updating a deployment

```sh
# Bump the server image tag to a specific SHA
kustomize edit set image tern/server=ghcr.io/<owner>/system-server:<sha>
kubectl apply -k k8s/overlays/prod
kubectl rollout status deployment/server -n tern-prod
```
