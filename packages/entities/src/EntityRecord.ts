import type { EdgeHandle } from "./EdgeHandle.js";

export interface EntityRecord<Props extends Record<string, unknown> = Record<string, unknown>> {
    id: string;
    iri: string;
    /**
     * All hydrated literal property values, keyed by the TypeScript property
     * name declared in the EntitySchema.  Collection properties (multiple quads
     * for the same predicate) are returned as arrays; scalar properties as
     * plain values.  Edges live in `edges`, never here.
     */
    props: Props;
    /**
     * Lazy handles to related entities, keyed by edge name from the schema's
     * `edges` map.  Each "out" edge resolves to an EdgeRef (cardinality "one")
     * or EdgeSet (cardinality "many"); call `.load(ctx)` to fetch the target(s).
     * Present only when the schema declares edges.
     */
    edges?: Record<string, EdgeHandle>;
}
