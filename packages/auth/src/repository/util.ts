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
    return iriStr.split("/").pop()!;
}

export function newSessionToken(): string {
    return randomBytes(32).toString("hex");
}
