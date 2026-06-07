// Single source of truth for system-owned URN namespaces. Every system IRI must
// derive from these — never hardcode the literal prefix. tern (the line-of-business
// product suite) owns "urn:tern:" separately via its own NS_TERN constant.
const NS = "urn:sys:";

export const NS_ROOT = `${NS}core:`; // urn:sys:core: — core (first-party) namespaces
export const NS_EXT = `${NS}ext:`; // urn:sys:ext:  — extension namespaces
export const NS_TEST = `${NS}test:`; // urn:sys:test: — test fixtures

/**
 * Builds an all-colon URN/URI from a root and segments — the one canonical way
 * to construct identifiers, instead of hand-joining template literals:
 *
 *   makeUri(NS_ROOT, "auth", "email")    -> "urn:sys:core:auth:email"
 *   makeUri(NS_ROOT, "auth", "user", id) -> "urn:sys:core:auth:user:<id>"
 *   makeUri("urn:sys:", "core", "food")  -> "urn:sys:core:food"
 *
 * The root may or may not end in ':'; every segment is joined with ':'. External
 * W3C IRIs (http://www.w3.org/...) are not URNs and should not use this.
 */
export function makeUri(root: string, ...pieces: string[]): string {
    const base = root.endsWith(":") ? root.slice(0, -1) : root;
    return pieces.length === 0 ? base : `${base}:${pieces.join(":")}`;
}
