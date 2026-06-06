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
    /** The entity type on the other end of the edge. */
    target: () => EntitySchema;
    /** Single related entity ("one", default) or a set ("many"). */
    cardinality?: EdgeCardinality;
    /** Edge orientation relative to this entity.  Defaults to "out". */
    direction?: EdgeDirection;
}
