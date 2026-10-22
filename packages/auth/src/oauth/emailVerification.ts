import type { OAuthProvider } from "../types.js";
import type { OAuthProfile } from "./types.js";

/** The error message (and login-attempt error code) for a refused, unverified address. */
export const OAUTH_EMAIL_NOT_VERIFIED = "oauth_email_not_verified";

/**
 * A provider sign-in whose address the provider does not vouch for.
 *
 * Sign-in finds the user by email, so an unverified address would let anyone
 * who can type someone else's address into a provider account sign in as
 * them, or claim the address before its owner does. Such a sign-in is refused
 * outright: no user is found, created, or linked.
 */
export class OAuthEmailNotVerifiedError extends Error {
    readonly provider: OAuthProvider;

    constructor(provider: OAuthProvider) {
        super(OAUTH_EMAIL_NOT_VERIFIED);
        this.name = "OAuthEmailNotVerifiedError";
        this.provider = provider;
    }
}

/** Throws OAuthEmailNotVerifiedError unless the provider verified the profile's address. */
export function assertEmailVerified(provider: OAuthProvider, profile: OAuthProfile): void {
    if (profile.emailVerified !== true) {
        throw new OAuthEmailNotVerifiedError(provider);
    }
}
