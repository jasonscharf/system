import type { ISecretsProvider } from "./ISecretsProvider.js";

/** Metadata server token endpoint. Only resolvable from inside GCP. */
const METADATA_TOKEN_URL =
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

/** Refresh this long before the token actually expires. */
const TOKEN_MARGIN_MS = 60_000;

/**
 * Reads secrets from GCP Secret Manager, one secret at a time.
 *
 * The point of reading them individually is that Secret Manager grants access
 * PER SECRET: infra/pulumi/gcp gives the node's service account
 * `secretmanager.secretAccessor` on each container separately, so a workload
 * can be given the database password without also being handed the field
 * encryption ring. Flattening the same values into one env bundle throws that
 * away, along with per-secret rotation and per-secret audit, which is why the
 * bundle this replaces was only ever marked INTERIM.
 *
 * Naming is the same convention AzureKeyVaultProvider uses, because it is the
 * same namespace spelled for a different transport: env vars use underscores
 * and secret names use hyphens.
 *
 *   SYS_FIELD_ENC_KEYS  ->  sys-field-enc-keys
 *   SYS_POSTGRES_PASSWORD -> sys-postgres-password
 *
 * ── Why the REST API and not @google-cloud/secret-manager ────────────────────
 * Authentication here is one HTTP GET against the metadata server, which hands
 * back a token for the service account the node already runs as. The SDK exists
 * to make credential discovery work in a dozen environments; in the only
 * environment this provider runs in, that discovery is a single request. Taking
 * the dependency would add a large transitive tree and a lockfile entry to
 * replace ten lines, so it is not taken. Nothing here is GCP-specific beyond
 * two URLs.
 *
 * The consequence, stated rather than discovered later: this works on GCP
 * compute and nowhere else. A workstation has no metadata server, which is
 * correct, because local development uses EnvSecretsProvider.
 *
 * ── Per-secret environment fallback ──────────────────────────────────────────
 * A key with no container (404) falls back to `process.env[key]`, exactly as the
 * Azure provider does. That lets non-sensitive runtime config live in a plain
 * ConfigMap while only real secrets live in Secret Manager, and callers ask for
 * both through one call. A 403 is NOT a fallback: it means the container exists
 * and this service account was not granted access to it, which is a deployment
 * mistake that must be loud rather than silently served from env.
 */
export class GcpSecretManagerProvider implements ISecretsProvider {
    private readonly _projectId: string;
    private _token: { value: string; expiresAt: number } | null = null;

    constructor(projectId: string) {
        this._projectId = projectId;
    }

    async get(key: string): Promise<string | null> {
        const name = this._secretName(key);
        const url =
            `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(this._projectId)}` +
            `/secrets/${encodeURIComponent(name)}/versions/latest:access`;

        const res = await fetch(url, {
            headers: { authorization: `Bearer ${await this._accessToken()}` },
        });

        if (res.status === 404) {
            return process.env[key] ?? null;
        }
        if (!res.ok) {
            throw new Error(
                `Secret Manager returned ${res.status} for '${name}' in project ` +
                    `${this._projectId}. A 403 here means the container exists but this ` +
                    `service account has no secretAccessor on it.`,
            );
        }

        // The payload is base64 whatever the stored bytes are, so decode as utf8
        // only at the edge. Values are stored without a trailing newline.
        const body = (await res.json()) as { payload?: { data?: string } };
        const data = body.payload?.data;
        if (data === undefined) {
            return process.env[key] ?? null;
        }
        return Buffer.from(data, "base64").toString("utf8");
    }

    async getRequired(key: string): Promise<string> {
        const value = await this.get(key);
        if (value === null) {
            throw new Error(
                `Secret '${key}' (Secret Manager name '${this._secretName(key)}') not found ` +
                    `in project ${this._projectId}, and no ${key} environment variable is set.`,
            );
        }
        return value;
    }

    /**
     * A token for the node's service account, cached until shortly before it
     * expires. Every secret read would otherwise cost a second round trip, and
     * boot reads a dozen of them.
     */
    private async _accessToken(): Promise<string> {
        const now = Date.now();
        if (this._token && now < this._token.expiresAt) {
            return this._token.value;
        }

        const res = await fetch(METADATA_TOKEN_URL, {
            headers: { "metadata-flavor": "Google" },
        });
        if (!res.ok) {
            throw new Error(
                `Could not get a token from the GCP metadata server (${res.status}). ` +
                    `This provider only runs on GCP compute; use EnvSecretsProvider elsewhere.`,
            );
        }

        const body = (await res.json()) as { access_token: string; expires_in: number };
        this._token = {
            value: body.access_token,
            expiresAt: now + body.expires_in * 1000 - TOKEN_MARGIN_MS,
        };
        return this._token.value;
    }

    /** SYS_FOO_BAR -> sys-foo-bar. Same mapping as the Azure provider. */
    private _secretName(key: string): string {
        return key.toLowerCase().replace(/_/g, "-");
    }
}
