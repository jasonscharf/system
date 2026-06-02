/**
 * sandbox-analytics — demonstration of cross-package entity extension via RDF.
 *
 * Extension data is written into a named subgraph scoped to this extension's
 * namespace and the target entity IRI.  Extensions never modify another
 * package's entity schema.
 */

export { projectPropertyMap, userPropertyMap } from "./analytics/propertyMaps.js";
export { shapes } from "./analytics/shapes.generated.js";
export type { Project } from "./analytics/types.generated.js";
export {
    analyticsRoleIRI,
    consentedToTrackingIRI,
    isActiveIRI,
    lastActiveAtIRI,
    ProjectIRI,
    projectCreatedAtIRI,
    projectMemberIRI,
    projectNameIRI,
    projectOwnerIRI,
    projectSlugIRI,
} from "./analytics/types.generated.js";
export type { ValidationResult, ValidationViolation } from "./validate/ShaclValidator.js";
export { validate } from "./validate/ShaclValidator.js";
