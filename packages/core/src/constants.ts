import { IRI } from "./semantics/IRI.js";

/**
 * Builds an all-colon URN/URI from a root and segments — the one canonical way
 * to construct identifiers, instead of hand-joining template literals:
 *
 *   makeUri(SYS_NS, "auth", "email")    -> "urn:sys:auth:email"
 *   makeUri(SYS_NS, "auth", "user", id) -> "urn:sys:auth:user:<id>"
 *   makeUri(NS_CORE, "msg", "ping")     -> "urn:sys:core:msg:ping"
 *
 * The root may or may not end in ':'; every segment is joined with ':'. External
 * W3C IRIs (http://www.w3.org/...) are not URNs and should not use this.
 */
export function makeUri(root: string, ...pieces: string[]): string {
    const base = root.endsWith(":") ? root.slice(0, -1) : root;
    return pieces.length === 0 ? base : `${base}:${pieces.join(":")}`;
}

// Single source of truth for system-owned URN namespaces. Every system IRI must
// derive from these via makeUri — never hardcode the literal prefix.
export const SYS_NS = "urn:sys";
export const NS_CORE = makeUri(SYS_NS, "core");  // "urn:sys:core"
export const NS_ROOT = SYS_NS;                    // alias; makeUri(NS_ROOT, ...) strips any trailing ':'
export const NS_EXT = makeUri(SYS_NS, "ext");     // "urn:sys:ext"
export const NS_TEST = makeUri(SYS_NS, "test");   // "urn:sys:test"
