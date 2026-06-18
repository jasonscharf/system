// auto-generated shapes descriptor — do not edit by hand
import type { ShaclNodeShape, ShaclShapes } from "@jasonscharf/gen";

const list: ShaclNodeShape[] = [
    {
        iri: "urn:sys:ui:shapes:MenuItemShape",
        targetClass: "urn:sys:ui:MenuItem",
        closed: false,
        properties: [{ path: "urn:sys:ui:hasParent", maxCount: 1 }],
    },
];

export const shapes: ShaclShapes = {
    nodeShapes: new Map(list.map((s) => [s.iri, s])),
    byTargetClass: new Map(list.map((s) => [s.targetClass, s])),
};
