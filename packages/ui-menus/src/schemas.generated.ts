// auto-generated — do not edit by hand

import { IRI } from "@jasonscharf/core";
import { EntitySchema } from "@jasonscharf/entities";

/** A named menu: an aggregate root that owns a set of menu items. The slot keys which placeholder in the shell renders it. */
export const MenuSchema: EntitySchema = new EntitySchema({
    typeIRI: new IRI("urn:sys:ui:Menu"),
    ns: "urn:sys:ui:",
    properties: {
        menuLabel: new IRI("urn:sys:ui:menuLabel"),
        menuSlot: new IRI("urn:sys:ui:menuSlot"),
    },
    edges: {
        hasItem: {
            predicate: new IRI("urn:sys:ui:hasItem"),
            target: () => MenuItemSchema,
            cardinality: "many",
            direction: "out",
        },
    },
});

/** A single contributed menu item. Activating it invokes a dispatch message of the configured kind. */
export const MenuItemSchema: EntitySchema = new EntitySchema({
    typeIRI: new IRI("urn:sys:ui:MenuItem"),
    ns: "urn:sys:ui:",
    idSegment: "item",
    properties: {
        label: new IRI("urn:sys:ui:label"),
        order: new IRI("urn:sys:ui:order"),
        requires: new IRI("urn:sys:ui:requires"),
        icon: new IRI("urn:sys:ui:icon"),
        dispatchKind: new IRI("urn:sys:ui:dispatchKind"),
        message: new IRI("urn:sys:ui:message"),
        messageArg: new IRI("urn:sys:ui:messageArg"),
    },
    edges: {
        hasParent: {
            predicate: new IRI("urn:sys:ui:hasParent"),
            target: () => MenuItemSchema,
            cardinality: "one",
            direction: "out",
        },
    },
});
