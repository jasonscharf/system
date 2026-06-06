// auto-generated shapes descriptor — do not edit by hand
import type { ShaclNodeShape, ShaclShapes } from "@jasonscharf/gen";

const list: ShaclNodeShape[] = [
    {
        iri: "urn:tern:ext:labs:shapes:UserAnalyticsShape",
        targetClass: "urn:tern:core:auth:User",
        closed: false,
        properties: [
            {
                path: "urn:tern:core:auth:email",
                minCount: 1,
                maxCount: 1,
                datatype: "http://www.w3.org/2001/XMLSchema#string",
                message: "A valid email address is required.",
            },
            {
                path: "urn:tern:ext:labs:analyticsRole",
                minCount: 1,
                maxCount: 1,
                datatype: "http://www.w3.org/2001/XMLSchema#string",
                pattern: "^(owner|member|viewer)$",
                message: "analyticsRole must be 'owner', 'member', or 'viewer'.",
            },
            {
                path: "urn:tern:ext:labs:consentedToTracking",
                maxCount: 1,
                datatype: "http://www.w3.org/2001/XMLSchema#boolean",
            },
            {
                path: "urn:tern:ext:labs:lastActiveAt",
                maxCount: 1,
                datatype: "http://www.w3.org/2001/XMLSchema#dateTime",
            },
        ],
    },
    {
        iri: "urn:tern:ext:labs:shapes:ProjectShape",
        targetClass: "urn:tern:ext:labs:Project",
        closed: true,
        properties: [
            {
                path: "urn:tern:ext:labs:projectName",
                minCount: 1,
                maxCount: 1,
                datatype: "http://www.w3.org/2001/XMLSchema#string",
                message: "projectName is required.",
            },
            {
                path: "urn:tern:ext:labs:projectSlug",
                minCount: 1,
                maxCount: 1,
                datatype: "http://www.w3.org/2001/XMLSchema#string",
                pattern: "^[a-z0-9][a-z0-9-]+[a-z0-9]$",
                message: "projectSlug must be lowercase-kebab-case (e.g. 'my-project').",
            },
            {
                path: "urn:tern:ext:labs:projectOwner",
                minCount: 1,
                maxCount: 1,
                classConstraint: "urn:tern:core:auth:User",
                message: "Every project must have exactly one owner.",
            },
            {
                path: "urn:tern:ext:labs:projectMember",
                classConstraint: "urn:tern:core:auth:User",
            },
            {
                path: "urn:tern:ext:labs:isActive",
                maxCount: 1,
                datatype: "http://www.w3.org/2001/XMLSchema#boolean",
            },
            {
                path: "urn:tern:ext:labs:projectCreatedAt",
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
