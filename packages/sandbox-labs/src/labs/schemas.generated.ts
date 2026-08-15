// auto-generated — do not edit by hand

import { IRI } from "@jasonscharf/core";
import { EntitySchema } from "@jasonscharf/entities";

/** A Tern platform user. */
export const UserSchema: EntitySchema = new EntitySchema({
    typeIRI: new IRI("urn:sys:core:auth:User"),
    ns: "urn:sys:core:auth:",
    properties: {
        email: new IRI("urn:sys:core:auth:email"),
        displayName: { iri: new IRI("urn:sys:core:auth:displayName"), pii: true },
        avatarUrl: { iri: new IRI("urn:sys:core:auth:avatarUrl"), pii: true },
        analyticsRole: new IRI("urn:sys:ext:labs:analyticsRole"),
        lastActiveAt: new IRI("urn:sys:ext:labs:lastActiveAt"),
        consentedToTracking: new IRI("urn:sys:ext:labs:consentedToTracking"),
    },
});

/** An analytics workspace scoped to a team or product. */
export const ProjectSchema: EntitySchema = new EntitySchema({
    typeIRI: new IRI("urn:sys:ext:labs:Project"),
    ns: "urn:sys:ext:labs:",
    properties: {
        projectName: new IRI("urn:sys:ext:labs:projectName"),
        projectSlug: new IRI("urn:sys:ext:labs:projectSlug"),
        isActive: new IRI("urn:sys:ext:labs:isActive"),
        contactEmail: { iri: new IRI("urn:sys:ext:labs:contactEmail"), pii: true },
    },
    edges: {
        projectOwner: {
            predicate: new IRI("urn:sys:ext:labs:projectOwner"),
            target: () => UserSchema,
            cardinality: "one",
            direction: "out",
        },
        projectMember: {
            predicate: new IRI("urn:sys:ext:labs:projectMember"),
            target: () => UserSchema,
            cardinality: "many",
            direction: "out",
        },
    },
});
