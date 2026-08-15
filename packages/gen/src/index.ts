export { generateExtensionDescriptor } from "./ExtensionGenerator.js";
export type { BaseOntologyConfig, GenConfig } from "./generate.js";
export { generate, generateFromConfig, generateTarget } from "./generate.js";
export type { GenTarget, LoadedManifest, TernManifest } from "./manifest.js";
export {
    findManifest,
    generateFromManifest,
    manifestInputs,
    manifestTargets,
    readManifest,
} from "./manifest.js";
export { parseNTriples } from "./NTriplesParser.js";
export type { Ontology, OntologyClass, OntologyProperty } from "./OntologyReader.js";
export { PII_MARKER_IRI, readOntology } from "./OntologyReader.js";
export type { SchemaGenConfig } from "./SchemaGenerator.js";
export { CONTAINS_IRI, generateSchemas } from "./SchemaGenerator.js";
export type { ShaclNodeShape, ShaclPropertyShape, ShaclShapes } from "./ShaclReader.js";
export { mergeShapes, readShaclShapes } from "./ShaclReader.js";
export type { ValidationResult, ValidationViolation } from "./ShaclValidator.js";
export { validate } from "./ShaclValidator.js";
export { generateShapesDescriptor } from "./ShapeGenerator.js";
export { parseTurtle } from "./TurtleParser.js";
export type { AugmentedGenConfig } from "./TypeGenerator.js";
export { generateAugmentedTypes, generateTypes } from "./TypeGenerator.js";
