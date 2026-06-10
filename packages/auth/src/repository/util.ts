import { randomBytes } from "node:crypto";
import { IRI, makeUri } from "@jasonscharf/core";
import { AUTH_NS } from "../constants.js";

export function newId(): string {
    return randomBytes(16).toString("hex");
}

export function iriFor(
    type: "user" | "identity" | "session" | "device" | "loginattempt",
    id: string,
): IRI {
    return new IRI(makeUri(AUTH_NS, type, id));
}

export function idFrom(iriStr: string): string {
    const seg = iriStr.match(/[^:/#]+$/)?.[0];
    if (seg == null) {
        throw new Error(`idFrom: could not extract id from IRI "${iriStr}"`);
    }
    return seg;
}

export function newSessionToken(): string {
    return randomBytes(32).toString("hex");
}
