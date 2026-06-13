// Precedence: secrets (vault) > process env > hardcoded defaults.
// Secrets are injected at runtime by vault mechanisms (AWS/Azure/GCP Secrets Manager).
"use server";

const _defaults = {
    SESSION_COOKIE: "tern_session",
    SESSION_TTL_SECS: String(7 * 24 * 60 * 60),
    OAUTH_STATE_COOKIE: "tern_oauth_state",
    OAUTH_STATE_TTL: String(10 * 60),
    GOOGLE_CLIENT_ID: "placeholder_google_client_id",
    GOOGLE_CLIENT_SECRET: "placeholder_google_client_secret",
    GITHUB_CLIENT_ID: "placeholder_github_client_id",
    GITHUB_CLIENT_SECRET: "placeholder_github_client_secret",
    // Auth abuse controls (TRN-171).
    // Sliding-window throttle on auth endpoints; counts are kept in the session store.
    AUTH_THROTTLE_WINDOW_SECS: String(60),
    AUTH_THROTTLE_MAX_PER_IP: String(20),
    AUTH_THROTTLE_MAX_PER_IDENTITY: String(10),
    // Comma-separated IP allowlist of trusted reverse proxies. Only when the
    // socket peer is in this list is the x-forwarded-for header honored.
    AUTH_TRUSTED_PROXIES: "",
    // Short TTL for negative-caching invalid session tokens so repeated garbage
    // tokens do not fall through to the triple store.
    AUTH_NEG_CACHE_TTL_SECS: String(30),
};

export const authEnv: Record<keyof typeof _defaults, string> = { ..._defaults };

(Object.keys(authEnv) as Array<keyof typeof _defaults>).forEach((key) => {
    if (process.env[key] !== undefined) {
        authEnv[key] = process.env[key] as string;
    }
});
