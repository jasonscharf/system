import type { Knex } from 'knex';
import { T } from '../schema.js';


const ISO = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/**
 * Database-level timestamp triggers.
 *
 * Moves responsibility for created_at / updated_at / deleted_at out of
 * application code and into the database engine.  Application code that
 * performs INSERT or UPDATE no longer needs to set these columns; the
 * triggers fill them in automatically.
 *
 * Rules enforced:
 *   created_at   — set to NOW() on INSERT; immutable thereafter (Postgres only).
 *   updated_at   — set to NOW() on INSERT; refreshed to NOW() on every UPDATE.
 *   deleted_at   — set to NOW() when is_deleted transitions false → true
 *                  (tern_edges only; nodes are never soft-deleted).
 *
 * SQLite notes
 * ─────────────
 *   • BEFORE INSERT triggers cannot modify NEW, so INSERT timestamps are
 *     written via a cheap AFTER INSERT UPDATE.
 *   • The UPDATE trigger is scoped to "AFTER UPDATE OF is_deleted" so it only
 *     fires during soft-delete operations; this avoids any risk of recursive
 *     trigger loops when the trigger's own UPDATE is executed.
 *   • 'now' is fixed for the duration of each SQL statement evaluation, so
 *     updated_at and deleted_at will always be identical when set together.
 *
 * Postgres notes
 * ──────────────
 *   • BEFORE INSERT / BEFORE UPDATE triggers can modify NEW directly, so no
 *     extra round-trip is needed.
 *   • NOW() is constant within a transaction, ensuring both timestamps are
 *     identical when set in the same trigger invocation.
 *   • Two separate trigger functions keep tern_nodes (no deleted_at column)
 *     and tern_edges (has deleted_at) cleanly decoupled.
 */
export async function up(knex: Knex): Promise<void> {
    const client = (knex.client as { config: { client: string } }).config.client;
    const isPg   = client === 'pg' || client === 'postgresql';

    if (isPg) {
        // ── Postgres ──────────────────────────────────────────────────────────

        await knex.raw(`
            CREATE OR REPLACE FUNCTION tern_node_timestamps()
            RETURNS TRIGGER LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'INSERT' THEN
                    NEW.created_at = NOW();
                    NEW.updated_at = NOW();
                ELSE
                    NEW.created_at = OLD.created_at;
                    NEW.updated_at = NOW();
                END IF;
                RETURN NEW;
            END; $$;
        `);

        await knex.raw(`
            CREATE OR REPLACE FUNCTION tern_edge_timestamps()
            RETURNS TRIGGER LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'INSERT' THEN
                    NEW.created_at = NOW();
                    NEW.updated_at = NOW();
                ELSE
                    NEW.created_at = OLD.created_at;
                    NEW.updated_at = NOW();
                    IF NEW.is_deleted AND NOT OLD.is_deleted THEN
                        NEW.deleted_at = NOW();
                    END IF;
                END IF;
                RETURN NEW;
            END; $$;
        `);

        await knex.raw(`DROP TRIGGER IF EXISTS tern_nodes_timestamps ON ${T.nodes}`);
        await knex.raw(`
            CREATE TRIGGER tern_nodes_timestamps
            BEFORE INSERT OR UPDATE ON ${T.nodes}
            FOR EACH ROW EXECUTE FUNCTION tern_node_timestamps();
        `);

        await knex.raw(`DROP TRIGGER IF EXISTS tern_edges_timestamps ON ${T.edges}`);
        await knex.raw(`
            CREATE TRIGGER tern_edges_timestamps
            BEFORE INSERT OR UPDATE ON ${T.edges}
            FOR EACH ROW EXECUTE FUNCTION tern_edge_timestamps();
        `);

    } else {
        // ── SQLite ────────────────────────────────────────────────────────────

        // Nodes: set created_at and updated_at on INSERT.
        // (Nodes are immutable after creation so no UPDATE trigger is needed.)
        await knex.raw(`
            CREATE TRIGGER IF NOT EXISTS tern_nodes_ts_insert
            AFTER INSERT ON ${T.nodes}
            BEGIN
                UPDATE ${T.nodes}
                SET created_at = ${ISO},
                    updated_at = ${ISO}
                WHERE id = NEW.id;
            END;
        `);

        // Edges: set created_at and updated_at on INSERT.
        await knex.raw(`
            CREATE TRIGGER IF NOT EXISTS tern_edges_ts_insert
            AFTER INSERT ON ${T.edges}
            BEGIN
                UPDATE ${T.edges}
                SET created_at = ${ISO},
                    updated_at = ${ISO}
                WHERE id = NEW.id;
            END;
        `);

        // Edges: refresh updated_at and set deleted_at when an edge is
        // soft-deleted (is_deleted: 0 → 1).  Scoping to "OF is_deleted"
        // means the trigger only fires when the UPDATE statement touches the
        // is_deleted column, preventing recursive firing from the UPDATE
        // this trigger itself issues (which touches updated_at/deleted_at only).
        await knex.raw(`
            CREATE TRIGGER IF NOT EXISTS tern_edges_ts_soft_delete
            AFTER UPDATE OF is_deleted ON ${T.edges}
            WHEN NEW.is_deleted = 1 AND OLD.is_deleted = 0
            BEGIN
                UPDATE ${T.edges}
                SET updated_at = ${ISO},
                    deleted_at = ${ISO}
                WHERE id = NEW.id;
            END;
        `);
    }
}

export async function down(knex: Knex): Promise<void> {
    const client = (knex.client as { config: { client: string } }).config.client;
    const isPg   = client === 'pg' || client === 'postgresql';

    if (isPg) {
        await knex.raw(`DROP TRIGGER IF EXISTS tern_nodes_timestamps ON ${T.nodes}`);
        await knex.raw(`DROP TRIGGER IF EXISTS tern_edges_timestamps ON ${T.edges}`);
        await knex.raw(`DROP FUNCTION IF EXISTS tern_node_timestamps()`);
        await knex.raw(`DROP FUNCTION IF EXISTS tern_edge_timestamps()`);
    } else {
        await knex.raw('DROP TRIGGER IF EXISTS tern_nodes_ts_insert');
        await knex.raw('DROP TRIGGER IF EXISTS tern_edges_ts_insert');
        await knex.raw('DROP TRIGGER IF EXISTS tern_edges_ts_soft_delete');
    }
}
