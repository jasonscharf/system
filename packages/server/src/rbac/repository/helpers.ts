import type { IRI } from "@jasonscharf/core";
import type { EdgeRef, EntityRecord } from "@jasonscharf/entities";
import { entityIri } from "@jasonscharf/entities";
import { RBAC_NS } from "../constants.js";

// The id helpers (newId / idFromIri / entityIri) now live in
// @jasonscharf/entities and are the single source every bounded context adopts;
// the divergent rbac copies (newId / idFrom / iriFor) that used to live in
// ./util.ts have been deleted. This module keeps only the rbac-specific
// quad-reading helpers plus a thin iriFor that pins the RBAC namespace.

export type RbacEntityType =
    | "tenant"
    | "group"
    | "sa"
    | "role"
    | "permission"
    | "grant"
    | "resource";

/**
 * Build a canonical rbac IRI (`urn:sys:core:rbac:<type>:<id>`).  Delegates to the
 * shared entityIri so the minting convention matches every other entity; the
 * rbac type segments are already lowercase, so this is exactly the old iriFor.
 */
export function iriFor(type: RbacEntityType, id: string): IRI {
    return entityIri(RBAC_NS, type, id);
}

/** Extract a single-valued ("one") edge handle from a record, or null. */
export function edgeRefOf(rec: EntityRecord, name: string): EdgeRef | null {
    const h = rec.edges?.[name];
    return h && "iri" in h ? (h as EdgeRef) : null;
}

/** Extract a string literal value from a quad's object, returning undefined if not a literal. */
export function literalValue(obj: unknown): string | undefined {
    if (obj != null && typeof obj === "object" && "value" in obj) {
        return String((obj as { value: unknown }).value);
    }
    return undefined;
}

/** Extract an IRI string from a quad's object, returning undefined if not an IRI. */
export function iriValue(obj: unknown): string | undefined {
    if (obj != null && typeof obj === "object" && "value" in obj && !("termType" in obj)) {
        return String((obj as { value: unknown }).value);
    }
    return undefined;
}
