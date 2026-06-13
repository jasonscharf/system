/**
 * sandbox-labs — demonstration of cross-package entity extension via RDF.
 *
 * Extension data is written into a named subgraph scoped to this extension's
 * namespace and the target entity IRI.  Extensions never modify another
 * package's entity schema.
 */

export { projectPropertyMap, userPropertyMap } from "./labs/propertyMaps.js";
export { ProjectSchema, UserSchema } from "./labs/schemas.generated.js";
export { shapes } from "./labs/shapes.generated.js";
export type { Project } from "./labs/types.generated.js";
export {
    analyticsRoleIRI,
    consentedToTrackingIRI,
    contactEmailIRI,
    isActiveIRI,
    lastActiveAtIRI,
    ProjectIRI,
    projectMemberIRI,
    projectNameIRI,
    projectOwnerIRI,
    projectSlugIRI,
} from "./labs/types.generated.js";
export type { ValidationResult, ValidationViolation } from "./validate/ShaclValidator.js";
export { validate } from "./validate/ShaclValidator.js";
