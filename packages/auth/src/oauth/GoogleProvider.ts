import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from "../constants.js";
import type { IOAuthProvider, OAuthResult } from "./types.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USER_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

interface GoogleTokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type: string;
}

interface GoogleUserInfo {
    sub: string;
    email: string;
    name?: string;
    picture?: string;
}

export class GoogleProvider implements IOAuthProvider {
    readonly name = "google" as const;

    private readonly _clientId: string;
    private readonly _clientSecret: string;

    constructor(clientId = GOOGLE_CLIENT_ID, clientSecret = GOOGLE_CLIENT_SECRET) {
        this._clientId = clientId;
        this._clientSecret = clientSecret;
    }

    getAuthUrl(redirectUri: string, state: string): string {
        const params = new URLSearchParams({
            client_id: this._clientId,
            redirect_uri: redirectUri,
            response_type: "code",
            scope: "openid email profile",
            state,
            access_type: "offline",
            prompt: "select_account",
        });
        return `${AUTH_URL}?${params.toString()}`;
    }

    async exchangeCode(code: string, redirectUri: string): Promise<OAuthResult> {
        const tokenRes = await fetch(TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                code,
                client_id: this._clientId,
                client_secret: this._clientSecret,
                redirect_uri: redirectUri,
                grant_type: "authorization_code",
            }).toString(),
        });

        if (!tokenRes.ok) {
            throw new Error(`Google token exchange failed: ${tokenRes.status}`);
        }

        const tokens = (await tokenRes.json()) as GoogleTokenResponse;

        const userRes = await fetch(USER_URL, {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
        });

        if (!userRes.ok) {
            throw new Error(`Google user info fetch failed: ${userRes.status}`);
        }

        const user = (await userRes.json()) as GoogleUserInfo;

        return {
            profile: {
                providerUserId: user.sub,
                email: user.email,
                displayName: user.name,
                avatarUrl: user.picture,
            },
            tokens: {
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                expiresAt: tokens.expires_in
                    ? new Date(Date.now() + tokens.expires_in * 1000)
                    : undefined,
            },
        };
    }
}
