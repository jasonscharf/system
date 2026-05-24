/**
 * Transaction-semantics tests for EntityStore and EntityQuery.
 *
 * Verifies two invariants for every method that hits the database:
 *   a) When ctx.trx is present the operation chains into that transaction.
 *   b) When ctx.trx is absent the method creates its own transaction and
 *      commits (or rolls back on error) before returning.
 *
 * Strategy:
 *   - "Chain + rollback" proves writes are chained: write inside a manually
 *     opened transaction, roll it back, verify data is gone.
 *   - "See uncommitted" proves reads are chained: write inside a manual
 *     transaction, read with the same ctx, verify the uncommitted row is visible.
 *   - "Auto-commit" proves a new transaction is created when none is supplied:
 *     write with an empty ctx, data must be immediately visible on a fresh read.
 *   - "Isolation" proves reads with no ctx cannot see another connection's
 *     uncommitted writes.  Only run on Postgres where READ COMMITTED is
 *     guaranteed across distinct connections; SQLite in-memory uses a single
 *     synchronous connection so cross-connection isolation is not meaningful.
 *
 * Runs against both SQLite and Postgres (when TERN_PG_URL is set), mirroring
 * the pattern used in entities.test.ts.
 */

import { IRI } from "@jasonscharf/core";
import { createDataContext, TripleStore } from "@jasonscharf/data";
import { EntitySchema, handle } from "@jasonscharf/entities";
import { EntityStore, entities } from "@jasonscharf/server";
import type { Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ── Provider matrix ───────────────────────────────────────────────────────────

interface DbProvider {
    name: string;
    isPg: boolean;
    create(): Promise<Knex>;
}

const providers: DbProvider[] = [
    {
        name: "SQLite",
        isPg: false,
        create: () => createDataContext({ client: "sqlite", filename: ":memory:" }),
    },
];

if (process.env.TERN_PG_URL) {
    const url = new URL(process.env.TERN_PG_URL);
    providers.push({
        name: "Postgres",
        isPg: true,
        create: () =>
            createDataContext({
                client: "pg",
                host: url.hostname,
                port: url.port ? Number(url.port) : 5432,
                database: url.pathname.slice(1),
                user: url.username,
                password: url.password,
            }),
    });
}

// ── Test schema ───────────────────────────────────────────────────────────────

const TrxHandle = handle("test:trx");
const titleIRI = new IRI("http://test.dev/trx/title");

function makeTrxSchema() {
    return new EntitySchema({
        typeIRI: new IRI("http://test.dev/trx/Item"),
        ns: "http://test.dev/trx/",
        coreGroup: {
            handle: TrxHandle,
            properties: { title: titleIRI },
        },
    });
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

async function setup(db: DbProvider) {
    const knex = await db.create();
    const store = new TripleStore(knex);
    const es = new EntityStore(store);
    const schema = makeTrxSchema();
    return { knex, store, es, schema };
}

async function teardown(env: Awaited<ReturnType<typeof setup>>) {
    await env.knex.destroy();
}

// ─────────────────────────────────────────────────────────────────────────────

for (const db of providers) {
    // ── EntityStore ───────────────────────────────────────────────────────────

    describe(`EntityStore — transaction semantics (${db.name})`, () => {
        let env: Awaited<ReturnType<typeof setup>>;

        beforeEach(async () => {
            env = await setup(db);
        });
        afterEach(async () => {
            await teardown(env);
        });

        // ── Write: auto-commit ────────────────────────────────────────────────

        it("testWriteWithoutTrxAutoCommits", async () => {
            const { es, schema } = env;
            const rec = await es.create({}, schema, { title: "auto-commit" });

            // Immediately visible on a fresh read — data was committed
            const found = await es.findById({}, schema, rec.id, "*");
            expect(found).not.toBeNull();
            expect(found?.groups[TrxHandle.id]?.title).toBe("auto-commit");
        });

        // ── Write: chaining ───────────────────────────────────────────────────

        it("testWriteWithTrxChainsIntoCallerTransaction", async () => {
            const { knex, es, schema } = env;
            const outerTrx = await knex.transaction();
            const txCtx = { trx: outerTrx };

            const rec = await es.create(txCtx, schema, { title: "chained" });

            // Readable within the same transaction
            const inTrx = await es.findById(txCtx, schema, rec.id, "*");
            expect(inTrx).not.toBeNull();

            // Roll back the caller's transaction — data must not have been committed
            await outerTrx.rollback();

            // Not visible after rollback
            const afterRollback = await es.findById({}, schema, rec.id, "*");
            expect(afterRollback).toBeNull();
        });

        it("testMultipleWritesChainAtomically", async () => {
            const { knex, es, schema } = env;
            const outerTrx = await knex.transaction();
            const txCtx = { trx: outerTrx };

            const a = await es.create(txCtx, schema, { title: "a" });
            const b = await es.create(txCtx, schema, { title: "b" });

            await outerTrx.rollback();

            // Neither entity committed
            expect(await es.findById({}, schema, a.id, "*")).toBeNull();
            expect(await es.findById({}, schema, b.id, "*")).toBeNull();
        });

        it("testUpdateGroupChainsIntoCallerTransaction", async () => {
            const { knex, es, schema } = env;

            // Commit the entity first (outside the chained trx)
            const rec = await es.create({}, schema, { title: "original" });

            const outerTrx = await knex.transaction();
            const txCtx = { trx: outerTrx };

            await es.updateGroup(txCtx, schema, rec.id, TrxHandle, { title: "updated" });

            // Change visible within the trx
            const inTrx = await es.findById(txCtx, schema, rec.id, "*");
            expect(inTrx?.groups[TrxHandle.id]?.title).toBe("updated");

            await outerTrx.rollback();

            // Original value restored after rollback
            const afterRollback = await es.findById({}, schema, rec.id, "*");
            expect(afterRollback?.groups[TrxHandle.id]?.title).toBe("original");
        });

        it("testDeleteChainsIntoCallerTransaction", async () => {
            const { knex, es, schema } = env;

            // Commit first
            const rec = await es.create({}, schema, { title: "will-delete" });

            const outerTrx = await knex.transaction();
            const txCtx = { trx: outerTrx };

            await es.delete(txCtx, schema, rec.id);

            // Gone within the trx
            expect(await es.findById(txCtx, schema, rec.id, "*")).toBeNull();

            await outerTrx.rollback();

            // Restored after rollback
            expect(await es.findById({}, schema, rec.id, "*")).not.toBeNull();
        });

        // ── Read: chaining ────────────────────────────────────────────────────

        it("testFindByIdChainsIntoCallerTrxSeesUncommittedWrites", async () => {
            const { knex, es, schema } = env;
            const outerTrx = await knex.transaction();
            const txCtx = { trx: outerTrx };

            // Write within the transaction (uncommitted)
            const rec = await es.create(txCtx, schema, { title: "uncommitted" });

            // Read with the same transaction ctx must see the uncommitted write
            const found = await es.findById(txCtx, schema, rec.id, "*");
            expect(found).not.toBeNull();
            expect(found?.groups[TrxHandle.id]?.title).toBe("uncommitted");

            await outerTrx.rollback();
        });

        it("testCollectionGetChainsIntoCallerTrx", async () => {
            const tagIRI = new IRI("http://test.dev/trx/tag");
            const tagHandle = handle("test:trx:tagged");
            const taggedSchema = new EntitySchema({
                typeIRI: new IRI("http://test.dev/trx/Tagged"),
                ns: "http://test.dev/trx/",
                coreGroup: {
                    handle: tagHandle,
                    properties: { tags: tagIRI },
                },
            });

            const { knex, es } = env;
            const outerTrx = await knex.transaction();
            const txCtx = { trx: outerTrx };

            const rec = await es.create(txCtx, taggedSchema, {});
            await es.collectionPush(
                txCtx,
                taggedSchema,
                rec.id,
                tagHandle,
                "tags",
                "alpha",
                "beta",
            );

            // collectionGet with same trx sees the uncommitted items
            const items = await es.collectionGet(txCtx, taggedSchema, rec.id, tagHandle, "tags");
            expect(items).toEqual(["alpha", "beta"]);

            await outerTrx.rollback();
        });

        // ── Isolation (Postgres only) ─────────────────────────────────────────

        it("testReadWithoutTrxDoesNotSeeOtherConnectionsUncommittedData", async () => {
            if (!db.isPg) {
                return;
            }

            const { knex, es, schema } = env;
            const outerTrx = await knex.transaction();
            const txCtx = { trx: outerTrx };

            const rec = await es.create(txCtx, schema, { title: "isolated" });

            // Read via a fresh ctx (new connection, READ COMMITTED) — must NOT see uncommitted data
            const found = await es.findById({}, schema, rec.id, "*");
            expect(found).toBeNull();

            await outerTrx.rollback();
        });
    });

    // ── EntityQuery ───────────────────────────────────────────────────────────

    describe(`EntityQuery — transaction semantics (${db.name})`, () => {
        let env: Awaited<ReturnType<typeof setup>>;

        beforeEach(async () => {
            env = await setup(db);
        });
        afterEach(async () => {
            await teardown(env);
        });

        it("testQueryAllWithoutTrxAutoCommitsReadsCommittedData", async () => {
            const { es, store, schema } = env;

            // Commit two entities
            const a = await es.create({}, schema, { title: "qa" });
            const b = await es.create({}, schema, { title: "qb" });

            const results = await entities(store).find(schema, "*").all({});
            const ids = results.map((r) => r.id);
            expect(ids).toContain(a.id);
            expect(ids).toContain(b.id);
        });

        it("testQueryAllChainsIntoCallerTrxSeesUncommittedWrites", async () => {
            const { knex, es, store, schema } = env;
            const outerTrx = await knex.transaction();
            const txCtx = { trx: outerTrx };

            const rec = await es.create(txCtx, schema, { title: "queried-uncommitted" });

            // Query with the same trx must see the uncommitted entity
            const results = await entities(store).find(schema, "*").all(txCtx);
            expect(results.map((r) => r.id)).toContain(rec.id);

            await outerTrx.rollback();
        });

        it("testQueryAllChainsRollbackRemovesResults", async () => {
            const { knex, es, store, schema } = env;
            const outerTrx = await knex.transaction();
            const txCtx = { trx: outerTrx };

            const rec = await es.create(txCtx, schema, { title: "gone-after-rollback" });
            expect((await entities(store).find(schema, "*").all(txCtx)).map((r) => r.id)).toContain(
                rec.id,
            );

            await outerTrx.rollback();

            // Not in results after rollback
            const results = await entities(store).find(schema, "*").all({});
            expect(results.map((r) => r.id)).not.toContain(rec.id);
        });

        it("testQueryCountChainsIntoCallerTrx", async () => {
            const { knex, es, store, schema } = env;
            const outerTrx = await knex.transaction();
            const txCtx = { trx: outerTrx };

            const before = await entities(store).find(schema, "*").count(txCtx);

            await es.create(txCtx, schema, { title: "counted" });

            const during = await entities(store).find(schema, "*").count(txCtx);
            expect(during).toBe(before + 1);

            await outerTrx.rollback();

            // Back to the original count after rollback
            const after = await entities(store).find(schema, "*").count({});
            expect(after).toBe(before);
        });

        it("testQueryIsolationOnPostgres", async () => {
            if (!db.isPg) {
                return;
            }

            const { knex, es, store, schema } = env;
            const outerTrx = await knex.transaction();
            const txCtx = { trx: outerTrx };

            await es.create(txCtx, schema, { title: "isolated-query" });

            // Query without trx must not see uncommitted write
            const results = await entities(store).find(schema, "*").all({});
            expect(results.every((r) => r.groups[TrxHandle.id]?.title !== "isolated-query")).toBe(
                true,
            );

            await outerTrx.rollback();
        });
    });
}
