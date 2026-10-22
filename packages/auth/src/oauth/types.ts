import type { OAuthProvider } from "../types.js";

export interface OAuthProfile {
    providerUserId: string;
    email: string;
    /**
     * True only when the provider itself vouches that the account owns
     * `email`. Sign-in links a provider identity to the user holding this
     * address, so an address the provider has not verified is refused rather
     * than trusted (see assertEmailVerified).
     */
    emailVerified: boolean;
    displayName?: string;
    avatarUrl?: string;
}

export interface OAuthTokens {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
}

export interface OAuthResult {
    profile: OAuthProfile;
    tokens: OAuthTokens;
}

export interface IOAuthProvider {
    readonly name: OAuthProvider;
    getAuthUrl(redirectUri: string, state: string): string;
    exchangeCode(code: string, redirectUri: string): Promise<OAuthResult>;
}
