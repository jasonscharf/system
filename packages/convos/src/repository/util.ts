import { randomBytes } from "node:crypto";
import { IRI, makeUri } from "@jasonscharf/core";
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

export function newId(): string {
    return randomBytes(16).toString("hex");
}

export function iriFor(type: ConvosEntityType, id: string): IRI {
    return new IRI(makeUri(CONVOS_NS, type, id));
}

export function idFrom(iriStr: string): string {
    const seg = iriStr.match(/[^:/#]+$/)?.[0];
    if (seg == null) {
        throw new Error(`idFrom: could not extract id from IRI "${iriStr}"`);
    }
    return seg;
}

/** Extract a string literal value from a quad object. */
export function literalValue(obj: unknown): string | undefined {
    if (obj != null && typeof obj === "object" && "value" in obj) {
        return String((obj as { value: unknown }).value);
    }
    return undefined;
}

/** Extract an IRI string from a quad object. Returns undefined for literal nodes. */
export function iriValue(obj: unknown): string | undefined {
    if (obj != null && typeof obj === "object" && "value" in obj && !("termType" in obj)) {
        return String((obj as { value: unknown }).value);
    }
    return undefined;
}
