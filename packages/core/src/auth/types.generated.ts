// auto-generated — do not edit by hand

import { IRI } from "../semantics/IRI.js";

/** A Tern platform user. */
export interface User {
    /** Primary email address. */
    email?: string;
    /** Human-readable display name. */
    displayName?: string;
    /** URL of the user's avatar image. */
    avatarUrl?: string;
}

export const UserIRI = new IRI("urn:sys:core:auth:User");

/** An OAuth identity linked to a user. */
export interface UserIdentity {
    /** OAuth provider identifier (e.g. 'google', 'github'). */
    provider?: string;
    /** The user's ID as issued by the OAuth provider. */
    providerUserId?: string;
    /** Email returned by the OAuth provider. */
    providerEmail?: string;
    /** Current OAuth access token. */
    accessToken?: string;
    /** OAuth refresh token (may be absent for some providers). */
    refreshToken?: string;
    /** Expiry time of the current access token. */
    tokenExpiresAt?: Date;
    /** Links an identity to its owning user. */
    identityOf?: User[];
}

export const UserIdentityIRI = new IRI("urn:sys:core:auth:UserIdentity");

/** An active session for a user on a device. */
export interface UserSession {
    /** Opaque session token stored in a cookie. */
    sessionToken?: string;
    /** Session expiry timestamp. */
    expiresAt?: Date;
    /** Whether the session is currently valid. */
    isActive?: boolean;
    /** Client IP address at time of login. */
    ipAddress?: string;
    /** The user this session belongs to. */
    sessionUser?: User;
    /** The device this session was created on. */
    sessionDevice?: UserDevice[];
}

export const UserSessionIRI = new IRI("urn:sys:core:auth:UserSession");

/** A device from which a user authenticates. */
export interface UserDevice {
    /** Human-readable device name (e.g. 'Chrome on macOS'). */
    deviceName?: string;
    /** Device platform: 'web', 'ios', 'android', or 'desktop'. */
    devicePlatform?: string;
    /** Raw HTTP User-Agent string. */
    deviceUserAgent?: string;
    /** The user who owns this device record. */
    deviceUser?: User[];
}

export const UserDeviceIRI = new IRI("urn:sys:core:auth:UserDevice");

/** An in-flight or completed OAuth login attempt. */
export interface LoginAttempt {
    /** OAuth provider identifier (e.g. 'google', 'github'). */
    provider?: string;
    /** Client IP address at time of login. */
    ipAddress?: string;
    /** Lifecycle status of the login attempt (e.g. 'pending', 'success', 'error'). */
    status?: string;
    /** Opaque single-use nonce correlating the OAuth redirect round-trip. */
    nonce?: string;
    /** Optional claim/invite token presented at the start of the attempt. */
    claim?: string;
    /** Raw HTTP User-Agent string captured at attempt time. */
    userAgent?: string;
    /** Error code recorded when the attempt fails. */
    errorCode?: string;
    /** UTM source attribution captured at attempt time. */
    utmSource?: string;
    /** UTM medium attribution captured at attempt time. */
    utmMedium?: string;
    /** UTM campaign attribution captured at attempt time. */
    utmCampaign?: string;
    /** Post-login redirect URL requested at attempt time. */
    authRedirectUrl?: string;
    /** The user resolved by a successful login attempt. */
    attemptUser?: User[];
}

export const LoginAttemptIRI = new IRI("urn:sys:core:auth:LoginAttempt");

export const emailIRI = new IRI("urn:sys:core:auth:email");
export const displayNameIRI = new IRI("urn:sys:core:auth:displayName");
export const avatarUrlIRI = new IRI("urn:sys:core:auth:avatarUrl");
export const providerIRI = new IRI("urn:sys:core:auth:provider");
export const providerUserIdIRI = new IRI("urn:sys:core:auth:providerUserId");
export const providerEmailIRI = new IRI("urn:sys:core:auth:providerEmail");
export const accessTokenIRI = new IRI("urn:sys:core:auth:accessToken");
export const refreshTokenIRI = new IRI("urn:sys:core:auth:refreshToken");
export const tokenExpiresAtIRI = new IRI("urn:sys:core:auth:tokenExpiresAt");
export const deviceNameIRI = new IRI("urn:sys:core:auth:deviceName");
export const devicePlatformIRI = new IRI("urn:sys:core:auth:devicePlatform");
export const deviceUserAgentIRI = new IRI("urn:sys:core:auth:deviceUserAgent");
export const sessionTokenIRI = new IRI("urn:sys:core:auth:sessionToken");
export const expiresAtIRI = new IRI("urn:sys:core:auth:expiresAt");
export const isActiveIRI = new IRI("urn:sys:core:auth:isActive");
export const ipAddressIRI = new IRI("urn:sys:core:auth:ipAddress");
export const statusIRI = new IRI("urn:sys:core:auth:status");
export const nonceIRI = new IRI("urn:sys:core:auth:nonce");
export const claimIRI = new IRI("urn:sys:core:auth:claim");
export const userAgentIRI = new IRI("urn:sys:core:auth:userAgent");
export const errorCodeIRI = new IRI("urn:sys:core:auth:errorCode");
export const utmSourceIRI = new IRI("urn:sys:core:auth:utmSource");
export const utmMediumIRI = new IRI("urn:sys:core:auth:utmMedium");
export const utmCampaignIRI = new IRI("urn:sys:core:auth:utmCampaign");
export const authRedirectUrlIRI = new IRI("urn:sys:core:auth:authRedirectUrl");
export const identityOfIRI = new IRI("urn:sys:core:auth:identityOf");
export const sessionUserIRI = new IRI("urn:sys:core:auth:sessionUser");
export const sessionDeviceIRI = new IRI("urn:sys:core:auth:sessionDevice");
export const deviceUserIRI = new IRI("urn:sys:core:auth:deviceUser");
export const attemptUserIRI = new IRI("urn:sys:core:auth:attemptUser");
