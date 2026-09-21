import { createHash, randomBytes } from "node:crypto";
import { type IRI, makeUri, NS_CORE } from "@jasonscharf/core";
import { entityIri, idFromIri, newId } from "@jasonscharf/entities";
import { AUTH_NS } from "../constants.js";

// The strict-throwing id helpers (newId, entityIri, idFromIri) now live in
// @jasonscharf/entities and are the single source other bounded contexts should
// adopt.  This module re-exports them under the auth-local names and keeps the
// auth-specific `iriFor(type, id)` convenience that pins the AUTH_NS namespace.

export { newId };

/** Strict-throwing id extractor from an entity IRI (re-exported from entities). */
export const idFrom: (iriStr: string) => string = idFromIri;

export function iriFor(
    type: "user" | "identity" | "session" | "device" | "loginattempt",
    id: string,
): IRI {
    return entityIri(AUTH_NS, type, id);
}

export function newSessionToken(): string {
    return randomBytes(32).toString("hex");
}

/**
 * One-way hash of a raw session token for at-rest storage and lookup.
 *
 * Session tokens are bearer credentials that are only ever compared, never read
 * back, so we persist sha256(token) (hex) rather than the raw token.  A leak of
 * the nodes table / a backup / a replica therefore cannot hand over live
 * sessions.  This is intentionally a plain unsalted sha256: the input is 256
 * bits of CSPRNG output, so it is not guessable and needs no per-row salt, and
 * lookup must be deterministic (a single indexed equality match, no table scan).
 */
export function hashSessionToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

/**
 * Fast-path session-store key for an already-hashed token.
 *
 * This is the one derivation of the session cache key. Every reader and writer
 * of the session cache reaches it through this function or through
 * `sessionCacheKey`, so the key one path writes is the key another path reads
 * and deletes. Keying by the hash rather than the raw token also keeps the
 * bearer credential out of the cache key, matching the at-rest representation.
 */
export function sessionCacheKeyFromHash(tokenHash: string): string {
    return makeUri(NS_CORE, "session", tokenHash);
}

/**
 * Fast-path session-store key for a raw bearer token. Hashes first, so callers
 * holding the raw token cannot accidentally key the cache by the credential.
 */
export function sessionCacheKey(rawToken: string): string {
    return sessionCacheKeyFromHash(hashSessionToken(rawToken));
}
