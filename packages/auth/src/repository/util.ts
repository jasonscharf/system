import { randomBytes } from "node:crypto";
import { IRI } from "@jasonscharf/core";
import { AUTH_NS } from "../constants.js";

export function newId(): string {
    return randomBytes(16).toString("hex");
}

export function iriFor(type: "user" | "identity" | "session" | "device", id: string): IRI {
    return new IRI(`${AUTH_NS}${type}/${id}`);
}

export function idFrom(iriStr: string): string {
    const seg = iriStr.split("/").pop();
    if (seg == null) {
        throw new Error(`idFrom: could not extract id from IRI "${iriStr}"`);
    }
    return seg;
}

export function newSessionToken(): string {
    return randomBytes(32).toString("hex");
}
