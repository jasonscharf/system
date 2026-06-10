/** Table and column names — single source of truth for the triple store schema. */

export const T = {
    namespaces: "namespaces",
    nodes: "nodes",
    edges: "edges",
} as const;

export const C = {
    id: "id",
    // namespaces
    prefix: "prefix",
    // namespaces + nodes (IRI kind)
    iri: "iri",
    // nodes
    kind: "kind",
    blankId: "blank_id",
    value: "value",
    datatype: "datatype",
    lang: "lang",
    valueJson: "value_json",
    // edges
    subject: "subject",
    predicate: "predicate",
    object: "object",
    graph: "graph",
    // time series / audit (all tables)
    createdAt: "created_at",
    updatedAt: "updated_at",
    // soft delete (edges only — nodes are immutable and never deleted)
    isDeleted: "is_deleted",
    deletedAt: "deleted_at",
} as const;

/** Well-known IRI used as the graph node for quads in the RDF default graph. */
export const DEFAULT_GRAPH_IRI = "urn:sys:graph:default";

export type NodeKind = "iri" | "blank" | "literal";

/**
 * JSON shape stored in the `value_json` column of literal nodes.
 * `v` holds the native typed value (boolean, number, or string).
 * This enables rich JSONB operators in Postgres and typed comparisons.
 */
export interface LiteralJson {
    /** The typed value — boolean/number for xsd:boolean/integer/decimal, string otherwise. */
    v: string | number | boolean;
    /** Datatype IRI. */
    dt: string;
    /** Language tag (only present for rdf:langString literals). */
    lang?: string;
}
