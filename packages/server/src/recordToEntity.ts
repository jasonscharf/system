import type { EntityRecord, EntitySchema } from "@jasonscharf/entities";

/**
 * A flat domain entity derived from an EntityRecord: every literal property,
 * plus `id`/`iri`/`createdAt`/`updatedAt`, plus an identity projection of each
 * declared "out" edge (`<edge>Id`/`<edge>Iri` for cardinality "one",
 * `<edge>Ids`/`<edge>Iris` for "many").  The edge fields land under the index
 * signature so they type-check without being enumerated.
 */
export type MappedEntity<Props extends Record<string, unknown>> = Props & {
    id: string;
    iri: string;
    createdAt?: Date;
    updatedAt?: Date;
} & Record<string, unknown>;

/**
 * Schema-derived mapping from a hydrated EntityRecord to a flat domain entity.
 *
 * Replaces the hand-written `_toEntity(record)` method repeated across ~21
 * repositories, each of which spreads the same `props` and copies
 * `id`/`iri`/`createdAt`/`updatedAt` by hand.  Literal values come straight from
 * `record.props`; each "out" edge is projected to its foreign identity so a
 * caller gets the target id/IRI without forcing a `.load()`.  Repositories with
 * bespoke per-field coercion override only the fields that differ, e.g.
 * `{ ...recordToEntity(Schema, rec), email: String(rec.props.email) }`.
 *
 * This intentionally does NOT fabricate timestamps: a record assembled by hand
 * (no DB-managed `createdAt`) maps to an entity with those fields absent rather
 * than a synthetic `new Date()`.
 */
export function recordToEntity<Props extends Record<string, unknown>>(
    schema: EntitySchema<Props>,
    record: EntityRecord<Props>,
): MappedEntity<Props> {
    const entity: Record<string, unknown> = {
        ...record.props,
        id: record.id,
        iri: record.iri,
    };
    if (record.createdAt !== undefined) {
        entity.createdAt = record.createdAt;
    }
    if (record.updatedAt !== undefined) {
        entity.updatedAt = record.updatedAt;
    }

    for (const [name, def] of Object.entries(schema.edges ?? {})) {
        if ((def.direction ?? "out") !== "out") {
            continue;
        }
        const handle = record.edges?.[name];
        if (!handle) {
            continue;
        }
        if ("iris" in handle) {
            entity[`${name}Iris`] = handle.iris;
            entity[`${name}Ids`] = handle.ids;
        } else {
            entity[`${name}Iri`] = handle.iri;
            entity[`${name}Id`] = handle.id;
        }
    }

    return entity as MappedEntity<Props>;
}
