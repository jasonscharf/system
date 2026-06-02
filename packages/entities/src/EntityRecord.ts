export interface EntityRecord {
    id: string;
    iri: string;
    /**
     * All hydrated property values, keyed by the TypeScript property name
     * declared in the EntitySchema.  Collection properties (multiple quads
     * for the same predicate) are returned as arrays; scalar properties as
     * plain values.
     */
    props: Record<string, unknown>;
}
