import type { IRI } from "@jasonscharf/core";
import { entityIri, idFromIri, newId } from "@jasonscharf/entities";
import { TENANCY_NS } from "./constants.js";

// The strict-throwing id helpers (newId, entityIri, idFromIri) live in
// @jasonscharf/entities and are the single source every bounded context adopts.
// This module re-exports them under the tenancy-local names and keeps the
// tenancy-specific `iriFor(type, id)` convenience that pins the TENANCY_NS
// namespace. The previous local copy diverged: its idFrom returned the whole IRI
// on a parse failure instead of throwing — that lenient behaviour is gone.

export { newId };

/** Strict-throwing id extractor from an entity IRI (re-exported from entities). */
export const idFrom: (iriStr: string) => string = idFromIri;

export function iriFor(type: "tenant" | "org", id: string): IRI {
    return entityIri(TENANCY_NS, type, id);
}
