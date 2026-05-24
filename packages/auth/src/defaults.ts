// Precedence: secrets (vault) > process env > hardcoded defaults.
// Secrets are injected at runtime by vault mechanisms (AWS/Azure/GCP Secrets Manager).
"use server";

const _defaults = {
    SESSION_COOKIE: "sys_session",
    SESSION_TTL_SECS: String(7 * 24 * 60 * 60),
    OAUTH_STATE_COOKIE: "sys_oauth_state",
    OAUTH_STATE_TTL: String(10 * 60),
    GOOGLE_CLIENT_ID: "placeholder_google_client_id",
    GOOGLE_CLIENT_SECRET: "placeholder_google_client_secret",
    GITHUB_CLIENT_ID: "placeholder_github_client_id",
    GITHUB_CLIENT_SECRET: "placeholder_github_client_secret",
};

export const authEnv: Record<keyof typeof _defaults, string> = { ..._defaults };

(Object.keys(authEnv) as Array<keyof typeof _defaults>).forEach((key) => {
    if (process.env[key] !== undefined) {
        authEnv[key] = process.env[key] as string;
    }
});
