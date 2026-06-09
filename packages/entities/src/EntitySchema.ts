import type { IRI } from "@jasonscharf/core";
import type { ShaclNodeShape } from "@jasonscharf/gen";
import type { EdgeDef } from "./EdgeDef.js";

export type DefaultValue<T> = T | (() => T);

/**
 * Full property declaration including the predicate IRI and optional XSD range.
 * The range IRI is included in the schema version hash, so changing it produces
 * a new version.  Use a bare IRI for untyped properties (range absent from hash).
 */
export interface PropertyDef {
    iri: IRI;
    range?: IRI;
}

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
    /**
     * Path segment used when minting entity IRIs (`{ns}{idSegment}/{id}`).
     * Defaults to the lowercased local name of typeIRI.  Override when the
     * stored convention differs (e.g. UserGroup → "group", PolicyGrant → "grant").
     */
    readonly idSegment?: string;
    /**
     * Properties accept either a bare IRI (predicate only) or a PropertyDef
     * { iri, range? } that also carries the XSD datatype.  Both forms are valid;
     * the range is only used for schema versioning and snapshot storage.
     */
    readonly properties: { readonly [K in keyof Props]: IRI | PropertyDef };
    /**
     * Topological relationships — edges whose object is another entity's IRI.
     * These replace foreign-key scalars (`domainId`, `tenantId`, `parentIri`…):
     * a value that *is another entity's identity* is an edge, never a literal.
     */
    readonly edges?: Readonly<Record<string, EdgeDef>>;
    readonly defaults?: { readonly [K in keyof Props]?: DefaultValue<Props[K]> };
    readonly shape?: ShaclNodeShape;
    /**
     * Named-graph domain key for tenant isolation, e.g. "labs".
     * When set, reads/writes scope to tenantGraph(ctx, graph) rather than
     * the bare tenant graph.  Absent means the bare tenant graph (or
     * DEFAULT_GRAPH when no tenantId is on ctx).
     */
    readonly graph?: string;
    /**
     * Absolute, tenant-independent named graph for entities that form a global
     * backbone rather than tenant-scoped data (e.g. the RBAC graph).  When set,
     * all reads/writes use this graph directly and tenant scoping is ignored.
     * Takes precedence over `graph`.
     */
    readonly graphIri?: IRI;

    constructor(opts: {
        typeIRI: IRI;
        ns: string;
        idSegment?: string;
        properties: { readonly [K in keyof Props]: IRI | PropertyDef };
        edges?: Readonly<Record<string, EdgeDef>>;
        defaults?: { readonly [K in keyof Props]?: DefaultValue<Props[K]> };
        shape?: ShaclNodeShape;
        graph?: string;
        graphIri?: IRI;
    }) {
        this.typeIRI = opts.typeIRI;
        this.ns = opts.ns;
        this.idSegment = opts.idSegment;
        this.properties = opts.properties;
        this.edges = opts.edges;
        this.defaults = opts.defaults;
        this.shape = opts.shape;
        this.graphIri = opts.graphIri;
        this.graph = opts.graph;
    }
}

/** Extract the predicate IRI from either a bare IRI or a PropertyDef. */
export function propIri(prop: IRI | PropertyDef): IRI {
    return "iri" in prop ? prop.iri : (prop as IRI);
}
