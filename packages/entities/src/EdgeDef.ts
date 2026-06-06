import type { IRI } from "@jasonscharf/core";
import type { EntitySchema } from "./EntitySchema.js";

/** "one" → a single related entity (EdgeRef); "many" → a set (EdgeSet). */
export type EdgeCardinality = "one" | "many";

/**
 * "out": this entity is the subject of the edge (entity --predicate--> target).
 *        These are the foreign-key replacements (domain, tenant, parent, …) and
 *        are hydrated eagerly as lazy handles on the record.
 * "in":  this entity is the object (target --predicate--> entity).  Inbound
 *        collections are resolved by query/traversal, not carried on the record.
 */
export type EdgeDirection = "out" | "in";

/**
 * Declares a topological relationship between entities — an edge whose object is
 * another entity's IRI, never a literal `fooId` scalar.
 *
 * `target` is a thunk so schemas may reference each other circularly.
 */
export interface EdgeDef {
    /** Predicate IRI for the edge. */
    predicate: IRI;
    /**
     * The entity type on the other end of the edge.  Optional: a polymorphic edge
     * (e.g. a grant's principal, which may be a User, Group, or ServiceAccount) has
     * no single target type.  When absent, the edge is still a first-class
     * topological link — it can be filtered, traversed, and navigated by IRI — but
     * a target id alone cannot be expanded to an IRI and `EdgeRef.load` is
     * unavailable (use the handle's `iri`, or pass a schema explicitly).
     */
    target?: () => EntitySchema;
    /** Single related entity ("one", default) or a set ("many"). */
    cardinality?: EdgeCardinality;
    /** Edge orientation relative to this entity.  Defaults to "out". */
    direction?: EdgeDirection;
}
