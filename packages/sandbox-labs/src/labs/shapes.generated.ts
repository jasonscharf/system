// auto-generated shapes descriptor — do not edit by hand
import type { ShaclNodeShape, ShaclShapes } from "@jasonscharf/gen";

const list: ShaclNodeShape[] = [
    {
        iri: "http://tern.dev/ns/labs/shapes/UserAnalyticsShape",
        targetClass: "http://tern.dev/ns/auth/User",
        closed: false,
        properties: [
            {
                path: "http://tern.dev/ns/auth/email",
                minCount: 1,
                maxCount: 1,
                datatype: "http://www.w3.org/2001/XMLSchema#string",
                message: "A valid email address is required.",
            },
            {
                path: "http://tern.dev/ns/labs/analyticsRole",
                minCount: 1,
                maxCount: 1,
                datatype: "http://www.w3.org/2001/XMLSchema#string",
                pattern: "^(owner|member|viewer)$",
                message: "analyticsRole must be 'owner', 'member', or 'viewer'.",
            },
            {
                path: "http://tern.dev/ns/labs/consentedToTracking",
                maxCount: 1,
                datatype: "http://www.w3.org/2001/XMLSchema#boolean",
            },
            {
                path: "http://tern.dev/ns/labs/lastActiveAt",
                maxCount: 1,
                datatype: "http://www.w3.org/2001/XMLSchema#dateTime",
            },
        ],
    },
    {
        iri: "http://tern.dev/ns/labs/shapes/ProjectShape",
        targetClass: "http://tern.dev/ns/labs/Project",
        closed: true,
        properties: [
            {
                path: "http://tern.dev/ns/labs/projectName",
                minCount: 1,
                maxCount: 1,
                datatype: "http://www.w3.org/2001/XMLSchema#string",
                message: "projectName is required.",
            },
            {
                path: "http://tern.dev/ns/labs/projectSlug",
                minCount: 1,
                maxCount: 1,
                datatype: "http://www.w3.org/2001/XMLSchema#string",
                pattern: "^[a-z0-9][a-z0-9-]+[a-z0-9]$",
                message: "projectSlug must be lowercase-kebab-case (e.g. 'my-project').",
            },
            {
                path: "http://tern.dev/ns/labs/projectOwner",
                minCount: 1,
                maxCount: 1,
                classConstraint: "http://tern.dev/ns/auth/User",
                message: "Every project must have exactly one owner.",
            },
            {
                path: "http://tern.dev/ns/labs/projectMember",
                classConstraint: "http://tern.dev/ns/auth/User",
            },
            {
                path: "http://tern.dev/ns/labs/isActive",
                maxCount: 1,
                datatype: "http://www.w3.org/2001/XMLSchema#boolean",
            },
            {
                path: "http://tern.dev/ns/labs/projectCreatedAt",
                maxCount: 1,
                datatype: "http://www.w3.org/2001/XMLSchema#dateTime",
            },
        ],
    },
];

export const shapes: ShaclShapes = {
    nodeShapes: new Map(list.map((s) => [s.iri, s])),
    byTargetClass: new Map(list.map((s) => [s.targetClass, s])),
};
