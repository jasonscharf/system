import type { Knex } from "knex";

const baselines = new WeakMap<object, Record<string, number>>();

const TABLES = ["edges", "nodes", "namespaces"] as const;

export async function recordMigrationBaseline(knex: Knex): Promise<void> {
    const counts: Record<string, number> = {};
    for (const table of TABLES) {
        const [row] = await knex(table).count<{ count: string }[]>("* as count");
        counts[table] = Number(row?.count ?? 0);
    }
    baselines.set(knex, counts);
}

export function getMigrationBaseline(knex: Knex): Record<string, number> {
    return baselines.get(knex) ?? {};
}
