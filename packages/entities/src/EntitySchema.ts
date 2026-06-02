import type { IRI } from "@jasonscharf/core";
import type { ShaclNodeShape } from "@jasonscharf/gen";

export type DefaultValue<T> = T | (() => T);

/**
 * Describes an entity type: its RDF class IRI, namespace, property→IRI map,
 * optional defaults, and optional SHACL shape for write-time validation.
 *
 * Properties are stored directly on the entity IRI — there is no intermediate
 * PropGroup node.
 */
export class EntitySchema<Props extends Record<string, unknown> = Record<string, unknown>> {
    readonly typeIRI: IRI;
    readonly ns: string;
    readonly properties: { readonly [K in keyof Props]: IRI };
    readonly defaults?: { readonly [K in keyof Props]?: DefaultValue<Props[K]> };
    readonly shape?: ShaclNodeShape;

    constructor(opts: {
        typeIRI: IRI;
        ns: string;
        properties: { readonly [K in keyof Props]: IRI };
        defaults?: { readonly [K in keyof Props]?: DefaultValue<Props[K]> };
        shape?: ShaclNodeShape;
    }) {
        this.typeIRI = opts.typeIRI;
        this.ns = opts.ns;
        this.properties = opts.properties;
        this.defaults = opts.defaults;
        this.shape = opts.shape;
    }
}
