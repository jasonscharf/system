import type { IRI } from "@terncosoftware/core";
import { entityIri, idFromIri, newId } from "@terncosoftware/entities";
import { CONVOS_NS } from "../constants.js";

export type ConvosEntityType =
    | "conversation"
    | "draft"
    | "inbox"
    | "membership"
    | "message"
    | "notification"
    | "participant"
    | "receipt"
    | "revision";

// The strict-throwing id helpers (newId, entityIri, idFromIri) now live in
// @terncosoftware/entities and are the single source other bounded contexts adopt.
// This module re-exports them under the convos-local names and keeps the
// convos-specific `iriFor(type, id)` convenience that pins the CONVOS_NS namespace.

export { newId };

/** Strict-throwing id extractor from an entity IRI (re-exported from entities). */
export const idFrom: (iriStr: string) => string = idFromIri;

export function iriFor(type: ConvosEntityType, id: string): IRI {
    return entityIri(CONVOS_NS, type, id);
}
