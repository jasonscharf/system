import { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } from "../constants.js";
import type { IOAuthProvider, OAuthResult } from "./types.js";

export const SYS_AUTH_GITHUB_OAUTH_URL = "https://github.com/login/oauth/authorize";
export const SYS_AUTH_GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
export const SYS_AUTH_GITHUB_USER_URL = "https://api.github.com/user";
export const SYS_AUTH_GITHUB_EMAIL_URL = "https://api.github.com/user/emails";

interface GitHubTokenResponse {
    access_token: string;
    token_type: string;
    scope: string;
}

interface GitHubUser {
    id: number;
    login: string;
    name?: string;
    avatar_url?: string;
    email?: string;
}

interface GitHubEmail {
    email: string;
    primary: boolean;
    verified: boolean;
}

export class GitHubProvider implements IOAuthProvider {
    readonly name = "github" as const;

    private readonly _clientId: string;
    private readonly _clientSecret: string;
    private readonly _authUrl: string;
    private readonly _tokenUrl: string;
    private readonly _userUrl: string;
    private readonly _emailUrl: string;

    constructor(
        clientId = GITHUB_CLIENT_ID,
        clientSecret = GITHUB_CLIENT_SECRET,
        urls?: { authUrl?: string; tokenUrl?: string; userUrl?: string; emailUrl?: string },
    ) {
        this._clientId = clientId;
        this._clientSecret = clientSecret;
        this._authUrl = urls?.authUrl ?? SYS_AUTH_GITHUB_OAUTH_URL;
        this._tokenUrl = urls?.tokenUrl ?? SYS_AUTH_GITHUB_TOKEN_URL;
        this._userUrl = urls?.userUrl ?? SYS_AUTH_GITHUB_USER_URL;
        this._emailUrl = urls?.emailUrl ?? SYS_AUTH_GITHUB_EMAIL_URL;
    }

    getAuthUrl(redirectUri: string, state: string): string {
        const params = new URLSearchParams({
            client_id: this._clientId,
            redirect_uri: redirectUri,
            scope: "read:user user:email",
            state,
        });
        return `${this._authUrl}?${params.toString()}`;
    }

    async exchangeCode(code: string, redirectUri: string): Promise<OAuthResult> {
        const tokenRes = await fetch(this._tokenUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Accept: "application/json",
            },
            body: new URLSearchParams({
                code,
                client_id: this._clientId,
                client_secret: this._clientSecret,
                redirect_uri: redirectUri,
            }).toString(),
        });

        if (!tokenRes.ok) {
            throw new Error(`GitHub token exchange failed: ${tokenRes.status}`);
        }

        const tokens = (await tokenRes.json()) as GitHubTokenResponse;

        const [userRes, emailRes] = await Promise.all([
            fetch(this._userUrl, {
                headers: {
                    Authorization: `Bearer ${tokens.access_token}`,
                    Accept: "application/vnd.github+json",
                },
            }),
            fetch(this._emailUrl, {
                headers: {
                    Authorization: `Bearer ${tokens.access_token}`,
                    Accept: "application/vnd.github+json",
                },
            }),
        ]);

        if (!userRes.ok) {
            throw new Error(`GitHub user fetch failed: ${userRes.status}`);
        }

        const user = (await userRes.json()) as GitHubUser;
        const emails = emailRes.ok ? ((await emailRes.json()) as GitHubEmail[]) : [];

        const primary =
            emails.find((e) => e.primary && e.verified)?.email ??
            user.email ??
            `${user.login}@users.noreply.github.com`;

        return {
            profile: {
                providerUserId: String(user.id),
                email: primary,
                displayName: user.name ?? user.login,
                avatarUrl: user.avatar_url,
            },
            tokens: {
                accessToken: tokens.access_token,
            },
        };
    }
}
