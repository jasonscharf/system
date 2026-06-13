import { createHash, randomBytes } from "node:crypto";
import type { IRI } from "@jasonscharf/core";
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
