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
    /**
     * DB-managed creation time, derived from the entity's edge rows' created_at
     * columns (set by triggers), not stored as a triple.  Populated on records
     * returned by create/findById/hydrateMany/EntityQuery; absent on records
     * assembled by hand.
     */
    createdAt?: Date;
    /**
     * DB-managed last-modification time, derived from the entity's edge rows'
     * updated_at columns (set by triggers), not stored as a triple.  Populated
     * alongside `createdAt`.
     */
    updatedAt?: Date;
}
