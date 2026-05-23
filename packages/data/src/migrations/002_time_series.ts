import type { Knex } from 'knex';
import { C, T } from '../schema.js';
import type { LiteralJson } from '../schema.js';


/**
 * Transforms the triple store into a graph + time series database.
 *
 * Changes applied:
 *
 *  tern_nodes
 *    - created_at  timestamptz  — when the node was first interned
 *    - updated_at  timestamptz  — last touched (nodes are immutable, updated when re-referenced)
 *    - value_json  jsonb        — for literal nodes: typed value { v, dt, lang? }
 *                                 Stored as JSONB in Postgres, JSON text in SQLite.
 *
 *  tern_edges
 *    - created_at  timestamptz  — when the quad was asserted
 *    - updated_at  timestamptz  — last state change (including soft-delete)
 *    - is_deleted  boolean      — true when this version of the quad has been superseded
 *    - deleted_at  timestamptz  — when is_deleted was set (null while active)
 *
 * The UNIQUE constraint on tern_edges is dropped because with soft-deletion the
 * same (subject, predicate, object, graph) tuple can appear multiple times in
 * history.  Deduplication of active quads is enforced at the application level
 * (SELECT-before-INSERT in TripleStore.insert).
 *
 * No data is ever hard-deleted after this migration.
 */
export async function up(knex: Knex): Promise<void> {
    const now = knex.fn.now();
    const client = (knex.client as { config: { client: string } }).config.client;
    const isPg   = client === 'pg' || client === 'postgresql';

    // ── tern_nodes ────────────────────────────────────────────────────────────

    const nodesHasCreatedAt = await knex.schema.hasColumn(T.nodes, C.createdAt);
    if (!nodesHasCreatedAt) {
        await knex.schema.alterTable(T.nodes, t => {
            t.timestamp(C.createdAt, { useTz: true }).notNullable().defaultTo(now);
            t.timestamp(C.updatedAt, { useTz: true }).notNullable().defaultTo(now);
            if (isPg) {
                t.specificType(C.valueJson, 'jsonb').nullable();
            } else {
                t.json(C.valueJson).nullable();
            }
        });
    }

    // ── tern_edges ────────────────────────────────────────────────────────────

    const edgesHasCreatedAt = await knex.schema.hasColumn(T.edges, C.createdAt);
    if (!edgesHasCreatedAt) {
        await knex.schema.alterTable(T.edges, t => {
            t.timestamp(C.createdAt, { useTz: true }).notNullable().defaultTo(now);
            t.timestamp(C.updatedAt, { useTz: true }).notNullable().defaultTo(now);
            t.boolean(C.isDeleted).notNullable().defaultTo(false);
            t.timestamp(C.deletedAt, { useTz: true }).nullable();
        });

        // Drop the old full unique constraint — soft-delete means the same quad
        // can appear multiple times in history.
        await knex.schema.alterTable(T.edges, t => {
            t.dropUnique([C.subject, C.predicate, C.object, C.graph]);
        });

        // Index to make active-edge queries fast.
        await knex.schema.alterTable(T.edges, t => {
            t.index([C.isDeleted, C.subject],   'tern_edges_active_subject_idx');
            t.index([C.isDeleted, C.predicate], 'tern_edges_active_predicate_idx');
            t.index([C.isDeleted, C.object],    'tern_edges_active_object_idx');
        });
    }

    // ── Populate value_json for existing literal nodes ────────────────────────

    const XSD = 'http://www.w3.org/2001/XMLSchema#';
    const literals = await knex(T.nodes)
        .where(C.kind, 'literal')
        .select<{ id: number; value: string; datatype: string | null; lang: string | null }[]>(
            C.id, C.value, C.datatype, C.lang,
        );

    for (const row of literals) {
        const dt  = row.datatype ?? `${XSD}string`;
        const raw = row.value ?? '';
        const json: LiteralJson = { v: coerceLiteralValue(raw, dt), dt };
        if (row.lang) { json.lang = row.lang; }

        await knex(T.nodes)
            .where(C.id, row.id)
            .update({ [C.valueJson]: JSON.stringify(json) });
    }
}

export async function down(knex: Knex): Promise<void> {
    // Restore the unique constraint before removing soft-delete columns.
    await knex.schema.alterTable(T.edges, t => {
        t.dropIndex([C.isDeleted, C.subject],   'tern_edges_active_subject_idx');
        t.dropIndex([C.isDeleted, C.predicate], 'tern_edges_active_predicate_idx');
        t.dropIndex([C.isDeleted, C.object],    'tern_edges_active_object_idx');

        t.unique([C.subject, C.predicate, C.object, C.graph]);
    });

    await knex.schema.alterTable(T.edges, t => {
        t.dropColumn(C.createdAt);
        t.dropColumn(C.updatedAt);
        t.dropColumn(C.isDeleted);
        t.dropColumn(C.deletedAt);
    });

    await knex.schema.alterTable(T.nodes, t => {
        t.dropColumn(C.createdAt);
        t.dropColumn(C.updatedAt);
        t.dropColumn(C.valueJson);
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const XSD = 'http://www.w3.org/2001/XMLSchema#';

/**
 * Converts the string representation of an XSD typed literal into its native
 * JavaScript equivalent for JSONB storage.
 */
function coerceLiteralValue(value: string, datatypeIri: string): string | number | boolean {
    switch (datatypeIri) {
        case `${XSD}boolean`:
            return value === 'true';

        case `${XSD}integer`:
        case `${XSD}int`:
        case `${XSD}long`:
        case `${XSD}short`:
        case `${XSD}byte`:
        case `${XSD}unsignedInt`:
        case `${XSD}unsignedLong`:
        case `${XSD}unsignedShort`: {
            const n = parseInt(value, 10);
            return isNaN(n) ? value : n;
        }

        case `${XSD}decimal`:
        case `${XSD}float`:
        case `${XSD}double`: {
            const n = parseFloat(value);
            return isNaN(n) ? value : n;
        }

        default:
            return value;
    }
}

export { coerceLiteralValue };
