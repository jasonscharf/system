// Single source of truth for system-owned URN namespaces. Every system IRI must
// derive from these — never hardcode the literal prefix. tern (the line-of-business
// product suite) owns "urn:tern:" separately via its own NS_TERN constant.
const NS = "urn:sys:";

export const NS_ROOT = `${NS}core:`; // urn:sys:core: — core (first-party) namespaces
export const NS_EXT = `${NS}ext:`; // urn:sys:ext:  — extension namespaces
export const NS_TEST = `${NS}test:`; // urn:sys:test: — test fixtures
