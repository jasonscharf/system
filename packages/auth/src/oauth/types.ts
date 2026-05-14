import type { OAuthProvider } from '../types.js';


export interface OAuthProfile {
    providerUserId: string;
    email: string;
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
