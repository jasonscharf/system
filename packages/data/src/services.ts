import { declareService } from "@jasonscharf/core";
import type { Knex } from "knex";
import { TripleStore } from "./TripleStore.js";

/**
 * Container token for the boot-owned database connection. Knex has no runtime
 * class to key on, so this minimal holder is the resolvable name. Bind at
 * boot, right after createDataContext:
 *
 *   bindService(DataSource, new DataSource(knex));
 */
export class DataSource {
    constructor(readonly knex: Knex) {}
}

declareService(DataSource);

// The process-wide TripleStore is boot-owned state (it wraps the live Knex),
// so it has no default: resolving before boot binds one throws
// ServiceNotBoundError instead of silently auto-constructing a broken store.
declareService(TripleStore);
