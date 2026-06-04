export interface SecurityContext {
    /** IRI of the authenticated principal (User or ServiceAccount). null = anonymous. */
    principalIri: string | null;
    /** Session entity ID. null for system / service calls. */
    sessionId: string | null;
    /** Raw session token, kept for fast-path revocation. null for system calls. */
    sessionToken: string | null;
    /** True when the principal is acting on behalf of another via rbac:actsFor. */
    isImpersonating: boolean;
    /** The IRI being acted as. Only set when isImpersonating is true. */
    actingAsIri?: string;
}

/** Used for internal system operations (seeding, migrations, background jobs). */
export const systemSec: SecurityContext = Object.freeze({
    principalIri: "http://tern.dev/ns/system",
    sessionId: null,
    sessionToken: null,
    isImpersonating: false,
});

/** Used for unauthenticated / anonymous requests. */
export const anonymousSec: SecurityContext = Object.freeze({
    principalIri: null,
    sessionId: null,
    sessionToken: null,
    isImpersonating: false,
});
