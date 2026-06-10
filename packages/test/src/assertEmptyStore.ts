import type { Knex } from "knex";

const STORE_TABLES = ["edges", "nodes", "namespaces"] as const;

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

/**
 * Asserts that every node and edge in the store is well-formed.
 *
 * Call this BEFORE rolling back the test transaction so any violation is caught
 * while the data is still visible.  Catches bugs that would otherwise silently
 * produce garbage rows.
 *
 * Invariants checked:
 *   - IRI nodes have a non-null `iri` column
 *   - Blank nodes have a non-null `blank_id` column
 *   - Literal nodes have a non-null `value` column
 *   - No edges have a null `graph` — every quad must be in a named graph
 *     (quads in the RDF default graph use the urn:sys:graph:default node)
 */
export async function assertStoreIntegrity(knex: Knex): Promise<void> {
    const violations: string[] = [];

    const badIri = await knex("nodes")
        .where({ kind: "iri" })
        .whereNull("iri")
        .count<[{ count: string | number }]>("* as count")
        .first();
    if (Number(badIri?.count ?? 0) > 0) {
        violations.push(`${badIri?.count} IRI nodes with null iri`);
    }

    const badBlank = await knex("nodes")
        .where({ kind: "blank" })
        .whereNull("blank_id")
        .count<[{ count: string | number }]>("* as count")
        .first();
    if (Number(badBlank?.count ?? 0) > 0) {
        violations.push(`${badBlank?.count} blank nodes with null blank_id`);
    }

    const badLiteral = await knex("nodes")
        .where({ kind: "literal" })
        .whereNull("value")
        .count<[{ count: string | number }]>("* as count")
        .first();
    if (Number(badLiteral?.count ?? 0) > 0) {
        violations.push(`${badLiteral?.count} literal nodes with null value`);
    }

    const nullGraph = await knex("edges")
        .whereNull("graph")
        .count<[{ count: string | number }]>("* as count")
        .first();
    if (Number(nullGraph?.count ?? 0) > 0) {
        violations.push(`${nullGraph?.count} edges with null graph`);
    }

    if (violations.length > 0) {
        throw new Error(`Store integrity violations: ${violations.join("; ")}`);
    }
}
