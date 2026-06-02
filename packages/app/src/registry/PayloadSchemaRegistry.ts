import type { TernTypeRef } from "@jasonscharf/core";
import type { ShaclNodeShape, ValidationResult } from "@jasonscharf/gen";
import { validate } from "@jasonscharf/gen";

interface RegisteredShape {
    readonly shape: ShaclNodeShape;
    readonly propertyMap: Record<string, string>;
}

/**
 * Maps message type IRIs to their SHACL payload shapes.
 *
 * Register a shape via register(typeRef, shape, propertyMap).
 * The payloadValidation() middleware uses this registry to validate incoming
 * request payloads before they reach any handler.
 */
export class PayloadSchemaRegistry {
    private readonly _shapes = new Map<string, RegisteredShape>();

    register(
        typeRef: TernTypeRef,
        shape: ShaclNodeShape,
        propertyMap: Record<string, string>,
    ): this {
        this._shapes.set(typeRef.iri, { shape, propertyMap });
        return this;
    }

    hasShape(typeIri: string): boolean {
        return this._shapes.has(typeIri);
    }

    /** Returns null if no shape is registered for this IRI. */
    validate(typeIri: string, payload: Record<string, unknown>): ValidationResult | null {
        const entry = this._shapes.get(typeIri);
        if (!entry) {
            return null;
        }
        return validate(payload, entry.shape, entry.propertyMap);
    }
}
