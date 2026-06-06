import type { Knex } from "knex";

const STORE_TABLES = ["tern_edges", "tern_nodes", "tern_names", "tern_namespaces"] as const;

/**
 * Asserts the quad store is completely empty.
 *
 * Call this in a DB suite's `afterEach`, AFTER the test transaction has rolled
 * back but BEFORE `knex.destroy()`. Because every test runs inside a
 * transaction that is rolled back, a clean suite leaves zero rows. Any non-zero
 * count means a query committed OUTSIDE the transaction — a leak that silently
 * breaks isolation on a shared database (Postgres) even though SQLite's
 * fresh-:memory:-per-test hides it. Failing loudly here pinpoints the suite.
 */
export async function assertEmptyStore(knex: Knex): Promise<void> {
    const dirty: string[] = [];
    for (const table of STORE_TABLES) {
        const [row] = await knex(table).count<{ count: string }[]>("* as count");
        const n = Number(row?.count ?? 0);
        if (n > 0) {
            dirty.push(`${table}=${n}`);
        }
    }
    if (dirty.length > 0) {
        throw new Error(
            `Store not empty after rollback — query(s) leaked outside the test transaction: ${dirty.join(", ")}`,
        );
    }
}
