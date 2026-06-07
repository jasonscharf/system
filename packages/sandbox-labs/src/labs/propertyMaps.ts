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
    email: "urn:sys:core:auth:email",
    displayName: "urn:sys:core:auth:displayName",
    avatarUrl: "urn:sys:core:auth:avatarUrl",
    analyticsRole: "urn:sys:ext:labs:analyticsRole",
    lastActiveAt: "urn:sys:ext:labs:lastActiveAt",
    consentedToTracking: "urn:sys:ext:labs:consentedToTracking",
};

export const projectPropertyMap: Record<string, string> = {
    projectName: "urn:sys:ext:labs:projectName",
    projectSlug: "urn:sys:ext:labs:projectSlug",
    projectOwner: "urn:sys:ext:labs:projectOwner",
    projectMember: "urn:sys:ext:labs:projectMember",
    isActive: "urn:sys:ext:labs:isActive",
};
