/** Table and column names — single source of truth for the triple store schema. */

export const T = {
    namespaces: 'tern_namespaces',
    names:      'tern_names',
    nodes:      'tern_nodes',
    edges:      'tern_edges',
} as const;

export const C = {
    id:          'id',
    // namespaces
    prefix:      'prefix',
    iri:         'iri',
    // names
    namespaceId: 'namespace_id',
    localName:   'local_name',
    // nodes
    kind:        'kind',
    nameId:      'name_id',
    blank:       'blank',
    value:       'value',
    datatype:    'datatype',
    lang:        'lang',
    valueJson:   'value_json',   // JSONB (Postgres) / JSON text (SQLite) for literal nodes
    // edges
    subject:     'subject',
    predicate:   'predicate',
    object:      'object',
    graph:       'graph',
    // time series / audit (all tables)
    createdAt:   'created_at',
    updatedAt:   'updated_at',
    // soft delete (edges only — nodes are immutable and never deleted)
    isDeleted:   'is_deleted',
    deletedAt:   'deleted_at',
} as const;

export type NodeKind = 'iri' | 'blank' | 'literal';

/**
 * JSON shape stored in the `value_json` column of literal nodes.
 * `v` holds the native typed value (boolean, number, or string).
 * This enables rich JSONB operators in Postgres and typed comparisons.
 */
export interface LiteralJson {
    /** The typed value — boolean/number for xsd:boolean/integer/decimal, string otherwise. */
    v:     string | number | boolean;
    /** Datatype IRI. */
    dt:    string;
    /** Language tag (only present for rdf:langString literals). */
    lang?: string;
}
