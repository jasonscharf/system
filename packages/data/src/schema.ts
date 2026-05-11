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
    // edges
    subject:     'subject',
    predicate:   'predicate',
    object:      'object',
    graph:       'graph',
} as const;

export type NodeKind = 'iri' | 'blank' | 'literal';
