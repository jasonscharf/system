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
    analyticsRole: "http://tern.dev/ns/analytics/analyticsRole",
    lastActiveAt: "http://tern.dev/ns/analytics/lastActiveAt",
    consentedToTracking: "http://tern.dev/ns/analytics/consentedToTracking",
};

export const projectPropertyMap: Record<string, string> = {
    projectName: "http://tern.dev/ns/analytics/projectName",
    projectSlug: "http://tern.dev/ns/analytics/projectSlug",
    projectOwner: "http://tern.dev/ns/analytics/projectOwner",
    projectMember: "http://tern.dev/ns/analytics/projectMember",
    isActive: "http://tern.dev/ns/analytics/isActive",
    projectCreatedAt: "http://tern.dev/ns/analytics/projectCreatedAt",
};
