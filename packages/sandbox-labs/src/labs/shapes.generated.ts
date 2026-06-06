// auto-generated shapes descriptor — do not edit by hand
import type { ShaclNodeShape, ShaclShapes } from "@jasonscharf/gen";

const list: ShaclNodeShape[] = [
    {
        iri: "urn:sys:ext:labs:shapes:UserAnalyticsShape",
        targetClass: "urn:sys:core:auth:User",
        closed: false,
        properties: [
            {
                path: "urn:sys:core:auth:email",
                minCount: 1,
                maxCount: 1,
                datatype: "http://www.w3.org/2001/XMLSchema#string",
                message: "A valid email address is required.",
            },
            {
                path: "urn:sys:ext:labs:analyticsRole",
                minCount: 1,
                maxCount: 1,
                datatype: "http://www.w3.org/2001/XMLSchema#string",
                pattern: "^(owner|member|viewer)$",
                message: "analyticsRole must be 'owner', 'member', or 'viewer'.",
            },
            {
                path: "urn:sys:ext:labs:consentedToTracking",
                maxCount: 1,
                datatype: "http://www.w3.org/2001/XMLSchema#boolean",
            },
            {
                path: "urn:sys:ext:labs:lastActiveAt",
                maxCount: 1,
                datatype: "http://www.w3.org/2001/XMLSchema#dateTime",
            },
        ],
    },
    {
        iri: "urn:sys:ext:labs:shapes:ProjectShape",
        targetClass: "urn:sys:ext:labs:Project",
        closed: true,
        properties: [
            {
                path: "urn:sys:ext:labs:projectName",
                minCount: 1,
                maxCount: 1,
                datatype: "http://www.w3.org/2001/XMLSchema#string",
                message: "projectName is required.",
            },
            {
                path: "urn:sys:ext:labs:projectSlug",
                minCount: 1,
                maxCount: 1,
                datatype: "http://www.w3.org/2001/XMLSchema#string",
                pattern: "^[a-z0-9][a-z0-9-]+[a-z0-9]$",
                message: "projectSlug must be lowercase-kebab-case (e.g. 'my-project').",
            },
            {
                path: "urn:sys:ext:labs:projectOwner",
                minCount: 1,
                maxCount: 1,
                classConstraint: "urn:sys:core:auth:User",
                message: "Every project must have exactly one owner.",
            },
            {
                path: "urn:sys:ext:labs:projectMember",
                classConstraint: "urn:sys:core:auth:User",
            },
            {
                path: "urn:sys:ext:labs:isActive",
                maxCount: 1,
                datatype: "http://www.w3.org/2001/XMLSchema#boolean",
            },
            {
                path: "urn:sys:ext:labs:projectCreatedAt",
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
