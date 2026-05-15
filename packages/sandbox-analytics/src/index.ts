/**
 * sandbox-analytics — demonstration of cross-package entity extension via RDF.
 *
 * Import this package's index (or call registerAnalytics() explicitly) to
 * register the analytics PropGroup on UserSchema before using EntityStore.
 */
import { UserSchema } from '@system/auth';
import { handle }     from '@system/entities';
import {
    analyticsRoleIRI,
    lastActiveAtIRI,
    consentedToTrackingIRI,
} from './analytics/types.generated.js';
import { shapes } from './analytics/shapes.generated.js';

/** The stable handle that identifies the analytics PropGroup on any entity. */
export const AnalyticsHandle = handle('com.tern.sandbox.analytics');

/**
 * Registers the analytics PropGroup on UserSchema.
 * Call once at application startup before any EntityStore operations.
 */
export function registerAnalytics(): void {
    UserSchema.register({
        handle:     AnalyticsHandle,
        properties: {
            analyticsRole:       analyticsRoleIRI,
            lastActiveAt:        lastActiveAtIRI,
            consentedToTracking: consentedToTrackingIRI,
        },
        shape: shapes.byTargetClass.get('http://tern.dev/ns/auth/User'),
    });
}

// Auto-register on import (side-effect import pattern — mirrors how
// database drivers self-register).  Call registerAnalytics() explicitly
// if you need to control timing.
registerAnalytics();

/**
 * sandbox-analytics — demonstration of cross-package entity extension via RDF.
 *
 * Pattern summary
 * ───────────────
 * 1. Write an OWL ontology (ontology/analytics.nt) that:
 *      a) Declares new classes (Project).
 *      b) Declares new properties whose rdfs:domain points at an existing
 *         class from a base package (auth:User) — the Open World Assumption
 *         makes this valid without touching the base package.
 *
 * 2. Write SHACL shapes (ontology/analytics.shacl.nt) that constrain both
 *    the base class (UserAnalyticsShape → auth:User) and the new class
 *    (ProjectShape → analytics:Project).
 *
 * 3. Run `yarn codegen` which calls:
 *      tern-codegen --config tern-gen.json
 *    This merges ALL triples (base + extension), resolves cross-namespace
 *    domain links, and emits:
 *      src/analytics/types.generated.ts   — TypeScript types
 *      src/analytics/shapes.generated.ts  — runtime shape data
 *
 * 4. Import the generated types.  Local classes become exported interfaces;
 *    extensions to base classes become `declare module '@system/core'` blocks
 *    that TypeScript merges with the originals via declaration merging.
 *
 * 5. Validate instances at runtime using ShaclValidator.validate().
 *
 * Usage example
 * ─────────────
 *   import type { User } from '@system/core';
 *   import type { Project } from '@system/sandbox-analytics';
 *   import { validate } from '@system/sandbox-analytics/validate';
 *   import { shapes, userPropertyMap, projectPropertyMap }
 *       from '@system/sandbox-analytics/analytics/shapes.generated';
 *
 *   const user: User = {
 *       email:        'alice@example.com',
 *       analyticsRole: 'owner',            // required by SHACL + type augmentation
 *       consentedToTracking: true,
 *   };
 *
 *   const project: Project = {
 *       projectName:  'Web Analytics',
 *       projectSlug:  'web-analytics',
 *       projectOwner: user,
 *   };
 *
 *   const userShape   = shapes.byTargetClass.get('http://tern.dev/ns/auth/User')!;
 *   const projectShape = shapes.byTargetClass.get('http://tern.dev/ns/analytics/Project')!;
 *
 *   const userResult    = validate(user as Record<string, unknown>, userShape, userPropertyMap);
 *   const projectResult = validate(project as Record<string, unknown>, projectShape, projectPropertyMap);
 *
 *   console.log(userResult.valid, projectResult.valid);  // true true
 */

export type { Project } from './analytics/types.generated.js';
export {
    ProjectIRI,
    analyticsRoleIRI,
    lastActiveAtIRI,
    consentedToTrackingIRI,
    projectNameIRI,
    projectSlugIRI,
    isActiveIRI,
    projectCreatedAtIRI,
    projectOwnerIRI,
    projectMemberIRI,
} from './analytics/types.generated.js';

export { shapes } from './analytics/shapes.generated.js';
export { userPropertyMap, projectPropertyMap } from './analytics/propertyMaps.js';
export { validate } from './validate/ShaclValidator.js';
export type { ValidationResult, ValidationViolation } from './validate/ShaclValidator.js';
