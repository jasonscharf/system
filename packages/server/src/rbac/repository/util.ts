import { randomBytes } from "node:crypto";
import { IRI } from "@jasonscharf/core";
import type { EdgeRef, EntityRecord } from "@jasonscharf/entities";
import { RBAC_NS } from "../constants.js";

/** Extract a single-valued ("one") edge handle from a record, or null. */
export function edgeRefOf(rec: EntityRecord, name: string): EdgeRef | null {
    const h = rec.edges?.[name];
    return h && "iri" in h ? (h as EdgeRef) : null;
}

export type RbacEntityType =
    | "tenant"
    | "group"
    | "sa"
    | "role"
    | "permission"
    | "grant"
    | "resource";

export function newId(): string {
    return randomBytes(16).toString("hex");
}

export function iriFor(type: RbacEntityType, id: string): IRI {
    return new IRI(`${RBAC_NS}${type}:${id}`);
}

export function idFrom(iriStr: string): string {
    const seg = iriStr.match(/[^:/#]+$/)?.[0];
    if (seg == null) {
        throw new Error(`idFrom: could not extract id from IRI "${iriStr}"`);
    }
    return seg;
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
