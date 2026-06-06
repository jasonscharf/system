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
    email: "urn:tern:core:auth:email",
    displayName: "urn:tern:core:auth:displayName",
    avatarUrl: "urn:tern:core:auth:avatarUrl",
    analyticsRole: "urn:tern:ext:labs:analyticsRole",
    lastActiveAt: "urn:tern:ext:labs:lastActiveAt",
    consentedToTracking: "urn:tern:ext:labs:consentedToTracking",
};

export const projectPropertyMap: Record<string, string> = {
    projectName: "urn:tern:ext:labs:projectName",
    projectSlug: "urn:tern:ext:labs:projectSlug",
    projectOwner: "urn:tern:ext:labs:projectOwner",
    projectMember: "urn:tern:ext:labs:projectMember",
    isActive: "urn:tern:ext:labs:isActive",
    projectCreatedAt: "urn:tern:ext:labs:projectCreatedAt",
};
