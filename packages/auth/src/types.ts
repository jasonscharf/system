export type OAuthProvider = 'google' | 'github';

export interface UserEntity {
    id: string;
    iri: string;
    email: string;
    displayName?: string;
    avatarUrl?: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface UserIdentityEntity {
    id: string;
    iri: string;
    provider: OAuthProvider;
    providerUserId: string;
    providerEmail: string;
    accessToken: string;
    refreshToken?: string;
    tokenExpiresAt?: Date;
    userId: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface UserSessionEntity {
    id: string;
    iri: string;
    sessionToken: string;
    userId: string;
    deviceId: string;
    expiresAt: Date;
    isActive: boolean;
    ipAddress?: string;
    createdAt: Date;
}

export interface UserDeviceEntity {
    id: string;
    iri: string;
    userId: string;
    deviceName?: string;
    devicePlatform?: string;
    deviceUserAgent?: string;
    createdAt: Date;
}

export interface SessionData {
    userId: string;
    deviceId: string;
    expiresAt: number;
}

export interface DeviceInfo {
    userAgent?: string;
    platform?: string;
    name?: string;
}
