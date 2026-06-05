/**
 * Maps TypeScript property names → their RDF IRI paths.
 *
 * Used by ShaclValidator.validate() so callers work with typed objects
 * (e.g. `user.email`) rather than raw IRI strings as object keys.
 *
 * This file is hand-maintained, NOT auto-generated.  Update it whenever
 * a new property is added to the analytics (or relevant base) ontologies
 * and the shapes need to validate it by name.
 */

export const userPropertyMap: Record<string, string> = {
    email: "http://tern.dev/ns/auth/email",
    displayName: "http://tern.dev/ns/auth/displayName",
    avatarUrl: "http://tern.dev/ns/auth/avatarUrl",
    analyticsRole: "http://tern.dev/ns/labs/analyticsRole",
    lastActiveAt: "http://tern.dev/ns/labs/lastActiveAt",
    consentedToTracking: "http://tern.dev/ns/labs/consentedToTracking",
};

export const projectPropertyMap: Record<string, string> = {
    projectName: "http://tern.dev/ns/labs/projectName",
    projectSlug: "http://tern.dev/ns/labs/projectSlug",
    projectOwner: "http://tern.dev/ns/labs/projectOwner",
    projectMember: "http://tern.dev/ns/labs/projectMember",
    isActive: "http://tern.dev/ns/labs/isActive",
    projectCreatedAt: "http://tern.dev/ns/labs/projectCreatedAt",
};
