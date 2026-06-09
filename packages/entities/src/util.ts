import { randomBytes } from "node:crypto";
import type { Literal } from "@jasonscharf/core";
import { IRI, literal, makeUri } from "@jasonscharf/core";
import { XSD_BOOLEAN, XSD_DATETIME, XSD_DECIMAL, XSD_INTEGER, XSD_STRING } from "./constants.js";
import type { PropertyDef } from "./EntitySchema.js";
import { propIri } from "./EntitySchema.js";

export function newId(): string {
    return randomBytes(16).toString("hex");
}

/** Build the IRI for an entity of a given type within a namespace. */
export function entityIri(ns: string, typeLocalName: string, id: string): IRI {
    return new IRI(makeUri(ns, typeLocalName.toLowerCase(), id));
}

/**
 * Build an entity IRI from a schema, honouring its idSegment override.
 * Defaults to the lowercased local name of the type IRI.
 */
export function entityIriFor(
    schema: { ns: string; idSegment?: string; typeIRI: IRI },
    id: string,
): IRI {
    const segment = schema.idSegment ?? localName(schema.typeIRI.value).toLowerCase();
    return new IRI(makeUri(schema.ns, segment, id));
}

/**
 * Derive the local name (final segment) from an IRI string.
 * Segments are delimited by ':' (URN), '/' (path), or '#' (fragment), so this
 * handles both urn:sys:* IRIs and external http(s) IRIs.
 */
export function localName(iri: string): string {
    const seg = iri.match(/[^:/#]+$/)?.[0];
    return seg ?? iri;
}

/** Extract the entity id from its IRI (final ':' / '/' / '#' segment). */
export function idFromIri(iriStr: string): string {
    const seg = iriStr.match(/[^:/#]+$/)?.[0];
    if (seg == null) {
        throw new Error(`idFromIri: could not extract id from IRI "${iriStr}"`);
    }
    return seg;
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

/** Build a Record<propName, iriString> reverse-lookup from an EntitySchema.properties map. */
export function invertPropertyMap(props: Record<string, IRI | PropertyDef>): Map<string, string> {
    return new Map(Object.entries(props).map(([name, p]) => [propIri(p).value, name]));
}

/** Build the propertyMap format expected by validate(): propName → IRI string. */
export function propertyMapFor(props: Record<string, IRI | PropertyDef>): Record<string, string> {
    return Object.fromEntries(Object.entries(props).map(([name, p]) => [name, propIri(p).value]));
}
