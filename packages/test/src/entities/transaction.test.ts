/**
 * Transaction-semantics tests for EntityStore and EntityQuery.
 *
 * Verifies two invariants for every method that hits the database:
 *   a) When ctx.trx is present the operation chains into that transaction.
 *   b) When ctx.trx is absent the method creates its own transaction and
 *      commits (or rolls back on error) before returning.
 */

import { IRI } from "@jasonscharf/core";
import { createDataContext, TripleStore } from "@jasonscharf/data";
import { EntitySchema } from "@jasonscharf/entities";
import { buildServerContext, EntityQuery, EntityStore } from "@jasonscharf/server";
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

const titleIRI = new IRI("http://test.dev/trx/title");

function makeTrxSchema() {
    return new EntitySchema({
        typeIRI: new IRI("http://test.dev/trx/Item"),
        ns: "http://test.dev/trx/",
        properties: { title: titleIRI },
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

        it("test write without trx auto commits", async () => {
            const { es, schema } = env;
            const rec = await es.create(buildServerContext(env.store), schema, { title: "auto-commit" });

            const found = await es.findById(buildServerContext(env.store), schema, rec.id);
            expect(found).not.toBeNull();
            expect(found?.props.title).toBe("auto-commit");
        });

        it("test write with trx chains into caller transaction", async () => {
            const { knex, es, schema } = env;
            const outerTrx = await knex.transaction();
            const txCtx = buildServerContext(env.store, { trx: outerTrx });

            const rec = await es.create(txCtx, schema, { title: "chained" });

            const inTrx = await es.findById(txCtx, schema, rec.id);
            expect(inTrx).not.toBeNull();

            await outerTrx.rollback();

            const afterRollback = await es.findById(buildServerContext(env.store), schema, rec.id);
            expect(afterRollback).toBeNull();
        });

        it("test multiple writes chain atomically", async () => {
            const { knex, es, schema } = env;
            const outerTrx = await knex.transaction();
            const txCtx = buildServerContext(env.store, { trx: outerTrx });

            const a = await es.create(txCtx, schema, { title: "a" });
            const b = await es.create(txCtx, schema, { title: "b" });

            await outerTrx.rollback();

            expect(await es.findById(buildServerContext(env.store), schema, a.id)).toBeNull();
            expect(await es.findById(buildServerContext(env.store), schema, b.id)).toBeNull();
        });

        it("test update chains into caller transaction", async () => {
            const { knex, es, schema } = env;

            const rec = await es.create(buildServerContext(env.store), schema, { title: "original" });

            const outerTrx = await knex.transaction();
            const txCtx = buildServerContext(env.store, { trx: outerTrx });

            await es.update(txCtx, schema, rec.id, { title: "updated" });

            const inTrx = await es.findById(txCtx, schema, rec.id);
            expect(inTrx?.props.title).toBe("updated");

            await outerTrx.rollback();

            const afterRollback = await es.findById(buildServerContext(env.store), schema, rec.id);
            expect(afterRollback?.props.title).toBe("original");
        });

        it("test delete chains into caller transaction", async () => {
            const { knex, es, schema } = env;

            const rec = await es.create(buildServerContext(env.store), schema, { title: "will-delete" });

            const outerTrx = await knex.transaction();
            const txCtx = buildServerContext(env.store, { trx: outerTrx });

            await es.delete(txCtx, schema, rec.id);

            expect(await es.findById(txCtx, schema, rec.id)).toBeNull();

            await outerTrx.rollback();

            expect(await es.findById(buildServerContext(env.store), schema, rec.id)).not.toBeNull();
        });

        it("test find by id chains into caller trx sees uncommitted writes", async () => {
            const { knex, es, schema } = env;
            const outerTrx = await knex.transaction();
            const txCtx = buildServerContext(env.store, { trx: outerTrx });

            const rec = await es.create(txCtx, schema, { title: "uncommitted" });

            const found = await es.findById(txCtx, schema, rec.id);
            expect(found).not.toBeNull();
            expect(found?.props.title).toBe("uncommitted");

            await outerTrx.rollback();
        });

        it("test collection get chains into caller trx", async () => {
            const tagIRI = new IRI("http://test.dev/trx/tag");
            const taggedSchema = new EntitySchema({
                typeIRI: new IRI("http://test.dev/trx/Tagged"),
                ns: "http://test.dev/trx/",
                properties: { tags: tagIRI },
            });

            const { knex, es } = env;
            const outerTrx = await knex.transaction();
            const txCtx = buildServerContext(env.store, { trx: outerTrx });

            const rec = await es.create(txCtx, taggedSchema, {});
            await es.collectionPush(txCtx, taggedSchema, rec.id, "tags", "alpha", "beta");

            const items = await es.collectionGet(txCtx, taggedSchema, rec.id, "tags");
            expect(items).toEqual(["alpha", "beta"]);

            await outerTrx.rollback();
        });

        it("test read without trx does not see other connections uncommitted data", async () => {
            if (!db.isPg) {
                return;
            }

            const { knex, es, schema } = env;
            const outerTrx = await knex.transaction();
            const txCtx = buildServerContext(env.store, { trx: outerTrx });

            const rec = await es.create(txCtx, schema, { title: "isolated" });

            const found = await es.findById(buildServerContext(env.store), schema, rec.id);
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

        it("test query all without trx auto commits reads committed data", async () => {
            const { es, store, schema } = env;

            const a = await es.create(buildServerContext(env.store), schema, { title: "qa" });
            const b = await es.create(buildServerContext(env.store), schema, { title: "qb" });

            const results = await EntityQuery.from(env.store, schema).all(buildServerContext(env.store));
            const ids = results.map((r) => r.id);
            expect(ids).toContain(a.id);
            expect(ids).toContain(b.id);
        });

        it("test query all chains into caller trx sees uncommitted writes", async () => {
            const { knex, es, store, schema } = env;
            const outerTrx = await knex.transaction();
            const txCtx = buildServerContext(env.store, { trx: outerTrx });

            const rec = await es.create(txCtx, schema, { title: "queried-uncommitted" });

            const results = await EntityQuery.from(env.store, schema).all(txCtx);
            expect(results.map((r) => r.id)).toContain(rec.id);

            await outerTrx.rollback();
        });

        it("test query all chains rollback removes results", async () => {
            const { knex, es, store, schema } = env;
            const outerTrx = await knex.transaction();
            const txCtx = buildServerContext(env.store, { trx: outerTrx });

            const rec = await es.create(txCtx, schema, { title: "gone-after-rollback" });
            expect((await EntityQuery.from(env.store, schema).all(txCtx)).map((r) => r.id)).toContain(
                rec.id,
            );

            await outerTrx.rollback();

            const results = await EntityQuery.from(env.store, schema).all(buildServerContext(env.store));
            expect(results.map((r) => r.id)).not.toContain(rec.id);
        });

        it("test query count chains into caller trx", async () => {
            const { knex, es, store, schema } = env;
            const outerTrx = await knex.transaction();
            const txCtx = buildServerContext(env.store, { trx: outerTrx });

            const before = await EntityQuery.from(env.store, schema).count(txCtx);

            await es.create(txCtx, schema, { title: "counted" });

            const during = await EntityQuery.from(env.store, schema).count(txCtx);
            expect(during).toBe(before + 1);

            await outerTrx.rollback();

            const after = await EntityQuery.from(env.store, schema).count(buildServerContext(env.store));
            expect(after).toBe(before);
        });

        it("test query isolation on postgres", async () => {
            if (!db.isPg) {
                return;
            }

            const { knex, es, store, schema } = env;
            const outerTrx = await knex.transaction();
            const txCtx = buildServerContext(env.store, { trx: outerTrx });

            await es.create(txCtx, schema, { title: "isolated-query" });

            const results = await EntityQuery.from(env.store, schema).all(buildServerContext(env.store));
            expect(results.every((r) => r.props.title !== "isolated-query")).toBe(true);

            await outerTrx.rollback();
        });
    });
}
