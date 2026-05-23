import { randomBytes } from "node:crypto";
import type { Literal } from "@jasonscharf/core";
import { IRI, literal } from "@jasonscharf/core";
import { XSD_BOOLEAN, XSD_DATETIME, XSD_DECIMAL, XSD_INTEGER, XSD_STRING } from "./constants.js";
import type { EntityHandle } from "./Handle.js";
import { handleSlug } from "./Handle.js";

export function newId(): string {
    return randomBytes(16).toString("hex");
}

/** Build the IRI for an entity of a given type within a namespace. */
export function entityIri(ns: string, typeLocalName: string, id: string): IRI {
    return new IRI(`${ns}${typeLocalName.toLowerCase()}/${id}`);
}

/** Derive the local name (last path/fragment segment) from an IRI string. */
export function localName(iri: string): string {
    const hash = iri.lastIndexOf("#");
    const slash = iri.lastIndexOf("/");
    return iri.slice(Math.max(hash, slash) + 1);
}

/** Build the PropGroup node IRI: entity IRI + `/pg/` + handle slug. */
export function pgIri(entityIriVal: string, h: EntityHandle): IRI {
    return new IRI(`${entityIriVal}/pg/${handleSlug(h)}`);
}

/** Extract the entity id from its IRI (last path segment). */
export function idFromIri(iriStr: string): string {
    return iriStr.split("/").pop()!;
}

/** Convert a JS value to an RDF Literal. */
export function toLiteral(value: unknown): Literal {
    if (typeof value === "boolean") {
        return literal(String(value), XSD_BOOLEAN);
    }
    if (typeof value === "number") {
        return Number.isInteger(value)
            ? literal(String(value), XSD_INTEGER)
            : literal(String(value), XSD_DECIMAL);
    }
    if (value instanceof Date) {
        return literal(value.toISOString(), XSD_DATETIME);
    }
    return literal(String(value), XSD_STRING);
}

/** Convert an RDF term back to a JS value. */
export function fromLiteral(term: unknown): unknown {
    if (term instanceof IRI) {
        return (term as IRI).value;
    }
    if (term !== null && typeof term === "object" && "termType" in term) {
        const t = term as { termType: string; value: string; datatype?: { value: string } };
        if (t.termType === "Literal") {
            const dt = t.datatype?.value ?? "";
            if (dt.endsWith("#boolean")) {
                return t.value === "true";
            }
            if (
                dt.endsWith("#integer") ||
                dt.endsWith("#decimal") ||
                dt.endsWith("#float") ||
                dt.endsWith("#double")
            ) {
                return Number(t.value);
            }
            if (dt.endsWith("#dateTime") || dt.endsWith("#date")) {
                return new Date(t.value);
            }
            return t.value;
        }
        if (t.termType === "BlankNode") {
            return t.value;
        }
    }
    return undefined;
}

/** Build a Record<propName, iriString> reverse-lookup from a PropGroupDef.properties map. */
export function invertPropertyMap(props: Record<string, IRI>): Map<string, string> {
    return new Map(Object.entries(props).map(([name, iri]) => [iri.value, name]));
}

/** Build the propertyMap format expected by validate(): propName → IRI string. */
export function propertyMapFor(props: Record<string, IRI>): Record<string, string> {
    return Object.fromEntries(Object.entries(props).map(([name, iri]) => [name, iri.value]));
}
