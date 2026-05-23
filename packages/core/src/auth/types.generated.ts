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

export const UserIRI = new IRI("http://tern.dev/ns/auth/User");

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

export const UserIdentityIRI = new IRI("http://tern.dev/ns/auth/UserIdentity");

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
    sessionUser?: User[];
    /** The device this session was created on. */
    sessionDevice?: UserDevice[];
}

export const UserSessionIRI = new IRI("http://tern.dev/ns/auth/UserSession");

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

export const UserDeviceIRI = new IRI("http://tern.dev/ns/auth/UserDevice");

export const emailIRI = new IRI("http://tern.dev/ns/auth/email");
export const displayNameIRI = new IRI("http://tern.dev/ns/auth/displayName");
export const avatarUrlIRI = new IRI("http://tern.dev/ns/auth/avatarUrl");
export const providerIRI = new IRI("http://tern.dev/ns/auth/provider");
export const providerUserIdIRI = new IRI("http://tern.dev/ns/auth/providerUserId");
export const providerEmailIRI = new IRI("http://tern.dev/ns/auth/providerEmail");
export const accessTokenIRI = new IRI("http://tern.dev/ns/auth/accessToken");
export const refreshTokenIRI = new IRI("http://tern.dev/ns/auth/refreshToken");
export const tokenExpiresAtIRI = new IRI("http://tern.dev/ns/auth/tokenExpiresAt");
export const deviceNameIRI = new IRI("http://tern.dev/ns/auth/deviceName");
export const devicePlatformIRI = new IRI("http://tern.dev/ns/auth/devicePlatform");
export const deviceUserAgentIRI = new IRI("http://tern.dev/ns/auth/deviceUserAgent");
export const sessionTokenIRI = new IRI("http://tern.dev/ns/auth/sessionToken");
export const expiresAtIRI = new IRI("http://tern.dev/ns/auth/expiresAt");
export const isActiveIRI = new IRI("http://tern.dev/ns/auth/isActive");
export const ipAddressIRI = new IRI("http://tern.dev/ns/auth/ipAddress");
export const createdAtIRI = new IRI("http://tern.dev/ns/auth/createdAt");
export const updatedAtIRI = new IRI("http://tern.dev/ns/auth/updatedAt");
export const identityOfIRI = new IRI("http://tern.dev/ns/auth/identityOf");
export const sessionUserIRI = new IRI("http://tern.dev/ns/auth/sessionUser");
export const sessionDeviceIRI = new IRI("http://tern.dev/ns/auth/sessionDevice");
export const deviceUserIRI = new IRI("http://tern.dev/ns/auth/deviceUser");
