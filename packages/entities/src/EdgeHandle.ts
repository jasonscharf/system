import type { ApplicationContext } from "@jasonscharf/core";
import type { EntityRecord } from "./EntityRecord.js";

/**
 * A lazy handle to a single related entity reached via an "out" edge.
 *
 * `iri`/`id` identify the target without a database hit; `load(ctx)` fetches and
 * hydrates it on demand.  This is what replaces a `fooId` scalar: the record
 * never carries a foreign key, only a navigable edge.
 */
export interface EdgeRef<T extends EntityRecord = EntityRecord> {
    /** IRI of the target entity. */
    iri: string;
    /** Id of the target entity (last IRI segment). */
    id: string;
    /** Fetch and hydrate the target entity, or null if it no longer exists. */
    load(ctx: ApplicationContext): Promise<T | null>;
}

/** A lazy handle to a set of related entities reached via a "many" edge. */
export interface EdgeSet<T extends EntityRecord = EntityRecord> {
    /** IRIs of the target entities. */
    iris: string[];
    /** Ids of the target entities. */
    ids: string[];
    /** Fetch and hydrate all target entities in a single batched round-trip. */
    load(ctx: ApplicationContext): Promise<T[]>;
}

export type EdgeHandle<T extends EntityRecord = EntityRecord> = EdgeRef<T> | EdgeSet<T>;
