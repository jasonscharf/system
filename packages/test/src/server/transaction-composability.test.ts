/**
 * Transaction-composability tests.
 *
 * Verifies the contract: every database-touching method on EntityStore,
 * CollectionViewStore and ExtensionRegistry either chains into a caller-supplied
 * ctx.trx or, when none is supplied, opens (and commits/rolls back) its own.
 *
 * The headline scenario: a dozen-plus different methods invoked under one outer
 * transaction must all be undone by a single rollback — proving they compose
 * into the same unit of work rather than auto-committing piecemeal.
 */

import { IRI } from "@jasonscharf/core";
import { createDataContext, TripleStore } from "@jasonscharf/data";
import { EntitySchema } from "@jasonscharf/entities";
import {
    buildServerContext,
    CollectionViewStore,
    EntityStore,
    ExtensionRegistry,
} from "@jasonscharf/server";
import type { Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ── Provider matrix ───────────────────────────────────────────────────────────

interface DbProvider {
    name: string;
    create(): Promise<Knex>;
}

const providers: DbProvider[] = [
    { name: "SQLite", create: () => createDataContext({ client: "sqlite", filename: ":memory:" }) },
];

if (process.env.SYS_PG_URL) {
    const url = new URL(process.env.SYS_PG_URL);
    providers.push({
        name: "Postgres",
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

// ── Test schema: a Doc with a tags collection ──────────────────────────────────

const titleIRI = new IRI("http://test.dev/doc/title");
const tagsIRI = new IRI("http://test.dev/doc/tags");

function makeDocSchema() {
    return new EntitySchema({
        typeIRI: new IRI("http://test.dev/doc/Doc"),
        ns: "http://test.dev/doc/",
        properties: { title: titleIRI, tags: tagsIRI },
    });
}

async function setup(db: DbProvider) {
    const knex = await db.create();
    const store = new TripleStore(knex);
    return {
        knex,
        store,
        es: new EntityStore(store),
        cvs: new CollectionViewStore(store),
        registry: new ExtensionRegistry(store),
        schema: makeDocSchema(),
    };
}

for (const db of providers) {
    describe(`Transaction composability (${db.name})`, () => {
        let env: Awaited<ReturnType<typeof setup>>;

        beforeEach(async () => {
            env = await setup(db);
        });
        afterEach(async () => {
            // Some tests here intentionally exercise the auto-commit path (no ambient
            // trx), so their writes commit. Clear the store before destroying the
            // connection so nothing leaks across the shared Postgres database.
            for (const t of ["edges", "nodes", "namespaces"]) {
                await env.knex(t).del();
            }
            await env.knex.destroy();
        });

        it("test many methods chain into one transaction and roll back together", async () => {
            const { knex, store, es, cvs, registry, schema } = env;
            const outerTrx = await knex.transaction();
            const txCtx = buildServerContext(store, { trx: outerTrx });

            // A grab-bag of distinct DB-touching methods, all under one trx.
            const doc = await es.create(txCtx, schema, { title: "draft" }); // 1
            await es.update(txCtx, schema, doc.id, { title: "revised" }); // 2
            await es.collectionPush(txCtx, schema, doc.id, "tags", "a", "b", "c"); // 3
            await es.collectionSet(txCtx, schema, doc.id, "tags", ["a", "b"]); // 4
            await es.collectionInsertAt(txCtx, schema, doc.id, "tags", 1, "z"); // 5
            const popped = await es.collectionPop(txCtx, schema, doc.id, "tags"); // 6
            const viewIri = await es.createCollectionView(txCtx, schema, doc.id, "tags"); // 7
            await cvs.addItem(txCtx, viewIri, "a"); // 8
            await cvs.reorder(txCtx, viewIri, ["a", "z"]); // 9
            await cvs.sync(txCtx, viewIri, ["a"]); // 10
            const viewBefore = await cvs.getView(txCtx, viewIri); // 11
            await cvs.removeItem(txCtx, viewIri, "a"); // 12
            await registry.record(txCtx, "crm", "1.0.0"); // 13
            const installed = await registry.list(txCtx); // 14

            // All of the above are visible inside the transaction.
            expect(popped).toBe("b");
            expect(viewBefore).not.toBeNull();
            expect(installed.map((e) => e.name)).toContain("crm");

            await outerTrx.rollback();

            // Nothing survives — every method participated in the same unit of work.
            const cleanCtx = buildServerContext(store);
            expect(await es.findById(cleanCtx, schema, doc.id)).toBeNull();
            expect(await cvs.getView(cleanCtx, viewIri)).toBeNull();
            expect(await registry.isInstalled(cleanCtx, "crm")).toBe(false);
        });

        it("test composite methods auto-commit when no trx is supplied", async () => {
            const { store, es, schema } = env;
            const ctx = buildServerContext(store);

            const doc = await es.create(ctx, schema, { title: "standalone" });
            await es.collectionPush(ctx, schema, doc.id, "tags", "x", "y");
            await es.collectionInsertAt(ctx, schema, doc.id, "tags", 0, "first");
            const popped = await es.collectionPop(ctx, schema, doc.id, "tags");
            const viewIri = await es.createCollectionView(ctx, schema, doc.id, "tags");

            expect(popped).toBe("y");
            const tags = await es.collectionGet(ctx, schema, doc.id, "tags");
            expect(tags).toEqual(["first", "x"]);
            const view = await es.views.getView(ctx, viewIri);
            expect(view?.items.map((i) => i.ref)).toEqual(["first", "x"]);
        });

        it("test ExtensionRegistry.record is atomic and re-recordable", async () => {
            const { knex, store, registry } = env;

            await registry.record(buildServerContext(store), "crm", "1.0.0");
            await registry.record(buildServerContext(store), "crm", "2.0.0");
            expect(await registry.getVersion(buildServerContext(store), "crm")).toBe("2.0.0");

            const outerTrx = await knex.transaction();
            const txCtx = buildServerContext(store, { trx: outerTrx });
            await registry.record(txCtx, "crm", "3.0.0");
            expect(await registry.getVersion(txCtx, "crm")).toBe("3.0.0");
            await outerTrx.rollback();

            expect(await registry.getVersion(buildServerContext(store), "crm")).toBe("2.0.0");
        });
    });
}
