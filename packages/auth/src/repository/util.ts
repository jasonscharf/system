import { randomBytes } from "node:crypto";
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
