import type { PropGroupDef } from './EntitySchema.js';


export interface EntityRecord {
    id:     string;
    iri:    string;
    /**
     * Groups keyed by handle.id string.  Each value is the hydrated prop object.
     * Collection properties (multiple quads for the same predicate) are returned
     * as arrays; scalar properties as plain values.
     */
    groups: Record<string, Record<string, unknown>>;
}

/**
 * Returns the data for a single PropGroup from an EntityRecord, narrowed to
 * the TypeScript type declared in the PropGroupDef.
 */
export function groupOf<Props extends Record<string, unknown>>(
    record: EntityRecord,
    def:    PropGroupDef<Props>,
): Props | undefined {
    return record.groups[def.handle.id] as Props | undefined;
}
