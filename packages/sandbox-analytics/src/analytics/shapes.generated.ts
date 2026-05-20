// auto-generated shapes descriptor — do not edit by hand
import type { ShaclShapes, ShaclNodeShape } from '@jasonscharf/gen';

const list: ShaclNodeShape[] = [
        {
            iri:         "http://tern.dev/ns/analytics/shapes/UserAnalyticsShape",
            targetClass: "http://tern.dev/ns/auth/User",
            closed:      false,
            properties: [
            { path: "http://tern.dev/ns/auth/email", minCount: 1, maxCount: 1, datatype: "http://www.w3.org/2001/XMLSchema#string", message: "A valid email address is required." },
            { path: "http://tern.dev/ns/analytics/analyticsRole", minCount: 1, maxCount: 1, datatype: "http://www.w3.org/2001/XMLSchema#string", pattern: "^(owner|member|viewer)$", message: "analyticsRole must be 'owner', 'member', or 'viewer'." },
            { path: "http://tern.dev/ns/analytics/consentedToTracking", maxCount: 1, datatype: "http://www.w3.org/2001/XMLSchema#boolean" },
            { path: "http://tern.dev/ns/analytics/lastActiveAt", maxCount: 1, datatype: "http://www.w3.org/2001/XMLSchema#dateTime" },
            ],
        },
        {
            iri:         "http://tern.dev/ns/analytics/shapes/ProjectShape",
            targetClass: "http://tern.dev/ns/analytics/Project",
            closed:      true,
            properties: [
            { path: "http://tern.dev/ns/analytics/projectName", minCount: 1, maxCount: 1, datatype: "http://www.w3.org/2001/XMLSchema#string", message: "projectName is required." },
            { path: "http://tern.dev/ns/analytics/projectSlug", minCount: 1, maxCount: 1, datatype: "http://www.w3.org/2001/XMLSchema#string", pattern: "^[a-z0-9][a-z0-9-]+[a-z0-9]$", message: "projectSlug must be lowercase-kebab-case (e.g. 'my-project')." },
            { path: "http://tern.dev/ns/analytics/projectOwner", minCount: 1, maxCount: 1, classConstraint: "http://tern.dev/ns/auth/User", message: "Every project must have exactly one owner." },
            { path: "http://tern.dev/ns/analytics/projectMember", classConstraint: "http://tern.dev/ns/auth/User" },
            { path: "http://tern.dev/ns/analytics/isActive", maxCount: 1, datatype: "http://www.w3.org/2001/XMLSchema#boolean" },
            { path: "http://tern.dev/ns/analytics/projectCreatedAt", maxCount: 1, datatype: "http://www.w3.org/2001/XMLSchema#dateTime" },
            ],
        },
];

export const shapes: ShaclShapes = {
    nodeShapes:    new Map(list.map(s => [s.iri, s])),
    byTargetClass: new Map(list.map(s => [s.targetClass, s])),
};
