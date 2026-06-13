export interface SecurityContext {
    /** IRI of the authenticated principal (User or ServiceAccount). null = anonymous. */
    principalIri: string | null;
    /** Session entity ID. null for system / service calls. Revocation keys off this. */
    sessionId: string | null;
    /** True when the principal is acting on behalf of another via rbac:actsFor. */
    isImpersonating: boolean;
    /** The IRI being acted as. Only set when isImpersonating is true. */
    actingAsIri?: string;
}

/** Used for internal system operations (seeding, migrations, background jobs). */
export const systemSec: SecurityContext = Object.freeze({
    principalIri: "urn:sys:core:system",
    sessionId: null,
    isImpersonating: false,
});

/** Used for unauthenticated / anonymous requests. */
export const anonymousSec: SecurityContext = Object.freeze({
    principalIri: null,
    sessionId: null,
    isImpersonating: false,
});
