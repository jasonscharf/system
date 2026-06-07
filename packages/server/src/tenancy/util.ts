import { IRI, makeUri } from "@jasonscharf/core";
import { randomBytes } from "node:crypto";
import { TENANCY_NS } from "./constants.js";

export function newId(): string {
	return randomBytes(16).toString("hex");
}

export function idFrom(iri: string): string {
	return iri.match(/[^:/#]+$/)?.[0] ?? iri;
}

export function iriFor(type: "tenant" | "org", id: string): IRI {
	return new IRI(makeUri(TENANCY_NS, type, id));
}
