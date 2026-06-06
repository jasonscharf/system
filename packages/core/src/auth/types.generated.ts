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
    /** Creation timestamp. */
    createdAt?: Date;
    /** Last-updated timestamp. */
    updatedAt?: Date;
}

export const UserIRI = new IRI("urn:tern:core:auth:User");

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
    /** Creation timestamp. */
    createdAt?: Date;
    /** Last-updated timestamp. */
    updatedAt?: Date;
    /** Links an identity to its owning user. */
    identityOf?: User[];
}

export const UserIdentityIRI = new IRI("urn:tern:core:auth:UserIdentity");

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
    /** Creation timestamp. */
    createdAt?: Date;
    /** The user this session belongs to. */
    sessionUser?: User;
    /** The device this session was created on. */
    sessionDevice?: UserDevice[];
}

export const UserSessionIRI = new IRI("urn:tern:core:auth:UserSession");

/** A device from which a user authenticates. */
export interface UserDevice {
    /** Human-readable device name (e.g. 'Chrome on macOS'). */
    deviceName?: string;
    /** Device platform: 'web', 'ios', 'android', or 'desktop'. */
    devicePlatform?: string;
    /** Raw HTTP User-Agent string. */
    deviceUserAgent?: string;
    /** Creation timestamp. */
    createdAt?: Date;
    /** The user who owns this device record. */
    deviceUser?: User[];
}

export const UserDeviceIRI = new IRI("urn:tern:core:auth:UserDevice");

export const emailIRI = new IRI("urn:tern:core:auth:email");
export const displayNameIRI = new IRI("urn:tern:core:auth:displayName");
export const avatarUrlIRI = new IRI("urn:tern:core:auth:avatarUrl");
export const providerIRI = new IRI("urn:tern:core:auth:provider");
export const providerUserIdIRI = new IRI("urn:tern:core:auth:providerUserId");
export const providerEmailIRI = new IRI("urn:tern:core:auth:providerEmail");
export const accessTokenIRI = new IRI("urn:tern:core:auth:accessToken");
export const refreshTokenIRI = new IRI("urn:tern:core:auth:refreshToken");
export const tokenExpiresAtIRI = new IRI("urn:tern:core:auth:tokenExpiresAt");
export const deviceNameIRI = new IRI("urn:tern:core:auth:deviceName");
export const devicePlatformIRI = new IRI("urn:tern:core:auth:devicePlatform");
export const deviceUserAgentIRI = new IRI("urn:tern:core:auth:deviceUserAgent");
export const sessionTokenIRI = new IRI("urn:tern:core:auth:sessionToken");
export const expiresAtIRI = new IRI("urn:tern:core:auth:expiresAt");
export const isActiveIRI = new IRI("urn:tern:core:auth:isActive");
export const ipAddressIRI = new IRI("urn:tern:core:auth:ipAddress");
export const createdAtIRI = new IRI("urn:tern:core:auth:createdAt");
export const updatedAtIRI = new IRI("urn:tern:core:auth:updatedAt");
export const identityOfIRI = new IRI("urn:tern:core:auth:identityOf");
export const sessionUserIRI = new IRI("urn:tern:core:auth:sessionUser");
export const sessionDeviceIRI = new IRI("urn:tern:core:auth:sessionDevice");
export const deviceUserIRI = new IRI("urn:tern:core:auth:deviceUser");
