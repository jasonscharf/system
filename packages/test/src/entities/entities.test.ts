/**
 * Entity system integration tests.
 *
 * Runs against both SQLite (always) and Postgres (when TERN_PG_URL is set),
 * each suite inside a rolled-back transaction so the schema stays clean.
 *
 * Covers:
 *   - UserSchema CRUD via EntityStore
 *   - Default values (createdAt / updatedAt auto-applied)
 *   - PropGroup extension + register()
 *   - EntityQuery: 1 / 2 / 3 attribute filters
 *   - Sorting (orderBy asc / desc)
 *   - Collection API: push / get / remove / pop / set / insertAt
 */

import { CoreHandle, UserSchema } from "@jasonscharf/auth";
import { IRI } from "@jasonscharf/core";
import { createDataContext, TripleStore } from "@jasonscharf/data";
import { EntitySchema, groupOf, handle, handleSlug } from "@jasonscharf/entities";
import type { ShaclNodeShape } from "@jasonscharf/gen";
import { defaultServerContext, EntityStore, EntityValidationError, entities } from "@jasonscharf/server";
import type { Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fromLiteral, invertPropertyMap, propertyMapFor } from "../../../entities/src/util.js";

// ── Provider matrix (mirrors the pattern in triples.test.ts) ─────────────────

interface DbProvider {
    name: string;
    create(): Promise<Knex>;
}

const providers: DbProvider[] = [
    { name: "SQLite", create: () => createDataContext({ client: "sqlite", filename: ":memory:" }) },
];

if (process.env.TERN_PG_URL) {
    const url = new URL(process.env.TERN_PG_URL);
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

// ── Test-specific schema (self-contained, no auth dependency for most tests) ──

const TestCoreHandle = handle("test:core");
const TestExtHandle = handle("test:ext");

const nameIRI = new IRI("http://test.dev/name");
const emailIRI = new IRI("http://test.dev/email");
const scoreIRI = new IRI("http://test.dev/score");
const activeIRI = new IRI("http://test.dev/active");
const tagIRI = new IRI("http://test.dev/tag");
const rankIRI = new IRI("http://test.dev/rank");

/**
 * Returns a fresh EntitySchema each time so register() calls in one test
 * don't leak into other tests.
 */
function makeTestSchema() {
    const schema = new EntitySchema({
        typeIRI: new IRI("http://test.dev/Item"),
        ns: "http://test.dev/",
        coreGroup: {
            handle: TestCoreHandle,
            properties: { name: nameIRI, email: emailIRI, score: scoreIRI, tags: tagIRI },
            defaults: { score: 0 },
        },
    });
    schema.register({
        handle: TestExtHandle,
        properties: { active: activeIRI, rank: rankIRI },
        defaults: { active: true },
    });
    return schema;
}

// ── Shared helper ─────────────────────────────────────────────────────────────

async function setup(db: DbProvider) {
    const knex = await db.create();
    const trx = await knex.transaction();
    const store = new TripleStore(knex);
    const es = new EntityStore(store);
    return { ...defaultServerContext, knex, trx, store, es };
}

async function teardown(ctx: Awaited<ReturnType<typeof setup>>) {
    await ctx.trx.rollback();
    await ctx.knex.destroy();
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite: runs once per DB provider
// ─────────────────────────────────────────────────────────────────────────────

for (const db of providers) {
    // ── CRUD via UserSchema ───────────────────────────────────────────────────

    describe(`EntityStore — UserSchema CRUD (${db.name})`, () => {
        let ctx: Awaited<ReturnType<typeof setup>>;
        let es: EntityStore;

        beforeEach(async () => {
            ctx = await setup(db);
            ({ es } = ctx);
        });
        afterEach(async () => {
            await teardown(ctx);
        });

        it("creates a user and returns an id / iri", async () => {
            const rec = await es.create(ctx, UserSchema, { email: "alice@example.com" });
            expect(rec.id).toBeTruthy();
            expect(rec.iri).toContain("http://tern.dev/ns/auth/user/");
            expect(rec.iri).toContain(rec.id);
        });

        it("applies createdAt / updatedAt defaults automatically", async () => {
            const rec = await es.create(ctx, UserSchema, { email: "bob@example.com" });
            const core = rec.groups[CoreHandle.id];
            if (core == null) {
                throw new Error("core group must not be null");
            }
            expect(core.createdAt).toBeInstanceOf(Date);
            expect(core.updatedAt).toBeInstanceOf(Date);
        });

        it("findById returns the entity with correct props", async () => {
            const created = await es.create(ctx, UserSchema, {
                email: "carol@example.com",
                displayName: "Carol",
            });
            const found = await es.findById(ctx, UserSchema, created.id, [CoreHandle]);
            if (found == null) {
                throw new Error("found must not be null");
            }
            const core = found.groups[CoreHandle.id];
            if (core == null) {
                throw new Error("core group must not be null");
            }
            expect(core.email).toBe("carol@example.com");
            expect(core.displayName).toBe("Carol");
        });

        it("findById returns null for unknown id", async () => {
            expect(await es.findById(ctx, UserSchema, "no-such-id", "*")).toBeNull();
        });

        it("updateGroup patches specific fields", async () => {
            const rec = await es.create(ctx, UserSchema, {
                email: "d@example.com",
                displayName: "Old",
            });
            await es.updateGroup(ctx, UserSchema, rec.id, CoreHandle, { displayName: "New" });
            const updated = await es.findById(ctx, UserSchema, rec.id, [CoreHandle]);
            expect(updated?.groups[CoreHandle.id]?.displayName).toBe("New");
            expect(updated?.groups[CoreHandle.id]?.email).toBe("d@example.com"); // unchanged
        });

        it("delete removes the entity and all PropGroups", async () => {
            const rec = await es.create(ctx, UserSchema, { email: "e@example.com" });
            await es.delete(ctx, UserSchema, rec.id);
            expect(await es.findById(ctx, UserSchema, rec.id, "*")).toBeNull();
        });

        it("addGroup attaches an extension PropGroup", async () => {
            const ExtHandle = handle("test:user-ext");
            const roleIRI = new IRI("http://test.dev/role");
            UserSchema.register({ handle: ExtHandle, properties: { role: roleIRI } });

            const rec = await es.create(ctx, UserSchema, { email: "f@example.com" });
            await es.addGroup(ctx, UserSchema, rec.id, ExtHandle, { role: "admin" });

            const full = await es.findById(ctx, UserSchema, rec.id, "*");
            expect(full?.groups[ExtHandle.id]?.role).toBe("admin");

            // Clean up — unregister is not supported, but the schema is shared so
            // we leave the registered handle in place (harmless, other tests use
            // their own schema instances via makeTestSchema()).
        });

        it("groupOf() helper narrows the type", async () => {
            const rec = await es.create(ctx, UserSchema, { email: "g@example.com" });
            const found = await es.findById(ctx, UserSchema, rec.id, [CoreHandle]);
            if (found == null) {
                throw new Error("found must not be null");
            }
            const firstGroup = UserSchema.allGroups()[0];
            if (firstGroup == null) {
                throw new Error("firstGroup must not be null");
            }
            const core = groupOf(found, firstGroup);
            expect(core).toBeDefined();
            expect(core?.email).toBe("g@example.com");
        });
    });

    // ── Default values ────────────────────────────────────────────────────────

    describe(`EntityStore — defaults (${db.name})`, () => {
        let ctx: Awaited<ReturnType<typeof setup>>;
        let es: EntityStore;
        beforeEach(async () => {
            ctx = await setup(db);
            ({ es } = ctx);
        });
        afterEach(async () => {
            await teardown(ctx);
        });

        it("applies static defaults when property is absent", async () => {
            const schema = makeTestSchema();
            const rec = await es.create(ctx, schema, { name: "Widget" });
            expect(rec.groups[TestCoreHandle.id]?.score).toBe(0);
        });

        it("does not override an explicitly supplied value", async () => {
            const schema = makeTestSchema();
            const rec = await es.create(ctx, schema, { name: "Widget", score: 99 });
            expect(rec.groups[TestCoreHandle.id]?.score).toBe(99);
        });

        it("applies defaults from extension PropGroup on addGroup", async () => {
            const schema = makeTestSchema();
            const rec = await es.create(ctx, schema, { name: "Widget" });
            await es.addGroup(ctx, schema, rec.id, TestExtHandle, { rank: 5 });
            const found = await es.findById(ctx, schema, rec.id, [TestExtHandle]);
            expect(found?.groups[TestExtHandle.id]?.active).toBe(true);
            expect(found?.groups[TestExtHandle.id]?.rank).toBe(5);
        });

        it("factory defaults produce independent values per entity", async () => {
            const rec1 = await es.create(ctx, UserSchema, { email: "h1@example.com" });
            await new Promise((r) => setTimeout(r, 5)); // ensure different timestamps
            const rec2 = await es.create(ctx, UserSchema, { email: "h2@example.com" });

            const t1 = rec1.groups[CoreHandle.id]?.createdAt as Date;
            const t2 = rec2.groups[CoreHandle.id]?.createdAt as Date;
            expect(t1.getTime()).toBeLessThanOrEqual(t2.getTime());
        });
    });

    // ── EntityQuery: 1 filter ─────────────────────────────────────────────────

    describe(`EntityQuery — 1 filter (${db.name})`, () => {
        let ctx: Awaited<ReturnType<typeof setup>>;
        let es: EntityStore;
        let schema: EntitySchema;

        beforeEach(async () => {
            ctx = await setup(db);
            ({ es } = ctx);
            schema = makeTestSchema();
            await es.create(ctx, schema, { name: "Alpha", email: "alpha@example.com", score: 10 });
            await es.create(ctx, schema, { name: "Beta", email: "beta@example.com", score: 20 });
            await es.create(ctx, schema, { name: "Gamma", email: "gamma@example.com", score: 30 });
        });
        afterEach(async () => {
            await teardown(ctx);
        });

        it("finds entity by exact email match", async () => {
            const results = await entities(ctx.store)
                .find(schema, [TestCoreHandle])
                .where(TestCoreHandle, "email", "=", "beta@example.com")
                .all(ctx);
            expect(results).toHaveLength(1);
            expect(results[0]?.groups[TestCoreHandle.id]?.name).toBe("Beta");
        });

        it("returns empty array when filter matches nothing", async () => {
            const results = await entities(ctx.store)
                .find(schema, [TestCoreHandle])
                .where(TestCoreHandle, "email", "=", "nobody@example.com")
                .all(ctx);
            expect(results).toHaveLength(0);
        });

        it("count() reflects filter", async () => {
            const n = await entities(ctx.store)
                .find(schema, [TestCoreHandle])
                .where(TestCoreHandle, "email", "=", "alpha@example.com")
                .count(ctx);
            expect(n).toBe(1);
        });

        it("first() returns one or null", async () => {
            const found = await entities(ctx.store)
                .find(schema, [TestCoreHandle])
                .where(TestCoreHandle, "name", "=", "Gamma")
                .first(ctx);
            expect(found).not.toBeNull();
            expect(found?.groups[TestCoreHandle.id]?.name).toBe("Gamma");
        });

        it("limit() + offset() paginate correctly", async () => {
            const page = await entities(ctx.store).find(schema, [TestCoreHandle]).limit(2).all(ctx);
            expect(page).toHaveLength(2);

            const rest = await entities(ctx.store)
                .find(schema, [TestCoreHandle])
                .offset(2)
                .all(ctx);
            expect(rest).toHaveLength(1);
        });
    });

    // ── EntityQuery: 2 filters ────────────────────────────────────────────────

    describe(`EntityQuery — 2 filters (${db.name})`, () => {
        let ctx: Awaited<ReturnType<typeof setup>>;
        let es: EntityStore;
        let schema: EntitySchema;

        beforeEach(async () => {
            ctx = await setup(db);
            ({ es } = ctx);
            schema = makeTestSchema();
            const a = await es.create(ctx, schema, {
                name: "Alice",
                email: "a@example.com",
                score: 10,
            });
            const b = await es.create(ctx, schema, {
                name: "Bob",
                email: "b@example.com",
                score: 20,
            });
            await es.addGroup(ctx, schema, a.id, TestExtHandle, { rank: 1, active: true });
            await es.addGroup(ctx, schema, b.id, TestExtHandle, { rank: 2, active: false });
        });
        afterEach(async () => {
            await teardown(ctx);
        });

        it("intersects two equality filters across two PropGroups", async () => {
            const results = await entities(ctx.store)
                .find(schema, [TestCoreHandle, TestExtHandle])
                .where(TestCoreHandle, "name", "=", "Alice")
                .where(TestExtHandle, "active", "=", true)
                .all(ctx);
            expect(results).toHaveLength(1);
            expect(results[0]?.groups[TestCoreHandle.id]?.name).toBe("Alice");
        });

        it("returns empty when filters exclude all entities", async () => {
            const results = await entities(ctx.store)
                .find(schema, [TestCoreHandle, TestExtHandle])
                .where(TestCoreHandle, "name", "=", "Alice")
                .where(TestExtHandle, "active", "=", false) // Alice is active:true
                .all(ctx);
            expect(results).toHaveLength(0);
        });
    });

    // ── EntityQuery: 3 filters ────────────────────────────────────────────────

    describe(`EntityQuery — 3 filters (${db.name})`, () => {
        let ctx: Awaited<ReturnType<typeof setup>>;
        let es: EntityStore;
        let schema: EntitySchema;

        beforeEach(async () => {
            ctx = await setup(db);
            ({ es } = ctx);
            schema = makeTestSchema();
            const entities_ = [
                { name: "P1", email: "p1@ex.com", score: 10 },
                { name: "P2", email: "p2@ex.com", score: 20 },
                { name: "P3", email: "p3@ex.com", score: 30 },
            ];
            for (const [i, e] of entities_.entries()) {
                const rec = await es.create(ctx, schema, e);
                await es.addGroup(ctx, schema, rec.id, TestExtHandle, {
                    rank: i + 1,
                    active: i !== 1, // P2 is inactive
                });
            }
        });
        afterEach(async () => {
            await teardown(ctx);
        });

        it("narrows to exactly one entity with 3 coincident conditions", async () => {
            const results = await entities(ctx.store)
                .find(schema, [TestCoreHandle, TestExtHandle])
                .where(TestCoreHandle, "name", "=", "P3")
                .where(TestCoreHandle, "score", "=", 30)
                .where(TestExtHandle, "active", "=", true)
                .all(ctx);
            expect(results).toHaveLength(1);
            expect(results[0]?.groups[TestCoreHandle.id]?.name).toBe("P3");
        });

        it("excludes entities that fail any of the three conditions", async () => {
            const results = await entities(ctx.store)
                .find(schema, [TestCoreHandle, TestExtHandle])
                .where(TestCoreHandle, "score", "=", 20) // only P2
                .where(TestExtHandle, "active", "=", true) // P2 is inactive
                .where(TestExtHandle, "rank", "=", 2)
                .all(ctx);
            expect(results).toHaveLength(0);
        });
    });

    // ── EntityQuery: sorting ──────────────────────────────────────────────────

    describe(`EntityQuery — sorting (${db.name})`, () => {
        let ctx: Awaited<ReturnType<typeof setup>>;
        let es: EntityStore;
        let schema: EntitySchema;

        beforeEach(async () => {
            ctx = await setup(db);
            ({ es } = ctx);
            schema = makeTestSchema();
            await es.create(ctx, schema, { name: "Charlie", score: 30 });
            await es.create(ctx, schema, { name: "Alice", score: 10 });
            await es.create(ctx, schema, { name: "Bob", score: 20 });
        });
        afterEach(async () => {
            await teardown(ctx);
        });

        it("orderBy string field ascending", async () => {
            const results = await entities(ctx.store)
                .find(schema, [TestCoreHandle])
                .orderBy(TestCoreHandle, "name", "asc")
                .all(ctx);
            const names = results.map((r) => r.groups[TestCoreHandle.id]?.name);
            expect(names).toEqual(["Alice", "Bob", "Charlie"]);
        });

        it("orderBy string field descending", async () => {
            const results = await entities(ctx.store)
                .find(schema, [TestCoreHandle])
                .orderBy(TestCoreHandle, "name", "desc")
                .all(ctx);
            const names = results.map((r) => r.groups[TestCoreHandle.id]?.name);
            expect(names).toEqual(["Charlie", "Bob", "Alice"]);
        });

        it("orderBy numeric field ascending", async () => {
            const results = await entities(ctx.store)
                .find(schema, [TestCoreHandle])
                .orderBy(TestCoreHandle, "score", "asc")
                .all(ctx);
            const scores = results.map((r) => r.groups[TestCoreHandle.id]?.score);
            expect(scores).toEqual([10, 20, 30]);
        });

        it("orderBy combined with filter", async () => {
            await es.create(ctx, schema, { name: "Dave", score: 10 });
            const results = await entities(ctx.store)
                .find(schema, [TestCoreHandle])
                .where(TestCoreHandle, "score", "=", 10)
                .orderBy(TestCoreHandle, "name", "asc")
                .all(ctx);
            const names = results.map((r) => r.groups[TestCoreHandle.id]?.name);
            expect(names).toEqual(["Alice", "Dave"]);
        });

        it("orderBy handles equal values (av === bv branch returns 0)", async () => {
            // Two entities with the same score — sort is stable; av===bv branch returns 0
            await es.create(ctx, schema, { name: "Extra", score: 10 });
            const results = await entities(ctx.store)
                .find(schema, [TestCoreHandle])
                .orderBy(TestCoreHandle, "score", "asc")
                .all(ctx);
            // Three records exist (Alice=10, Bob=20, Charlie=30) plus Extra=10
            const scores = results.map((r) => r.groups[TestCoreHandle.id]?.score);
            expect(scores.filter((s) => s === 10)).toHaveLength(2);
        });

        it("orderBy: bv==null when one record has no value for the sort prop", async () => {
            // Create an entity WITHOUT email — sort by email so one record has null bv
            await es.create(ctx, schema, { name: "HasEmail", email: "z@test.com", score: 99 });
            // Alice/Bob/Charlie have no email (not set in beforeEach)
            const results = await entities(ctx.store)
                .find(schema, [TestCoreHandle])
                .orderBy(TestCoreHandle, "email", "asc")
                .all(ctx);
            // HasEmail (z@test.com) should sort after null-email records;
            // the comparison av='z@test.com', bv=null hits the `bv==null ? 1` branch
            expect(results.length).toBeGreaterThanOrEqual(4);
            const emails = results.map((r) => r.groups[TestCoreHandle.id]?.email);
            expect(emails[emails.length - 1]).toBe("z@test.com");
        });
    });

    // ── Collection API ────────────────────────────────────────────────────────

    describe(`EntityStore — collections (${db.name})`, () => {
        let ctx: Awaited<ReturnType<typeof setup>>;
        let es: EntityStore;
        let schema: EntitySchema;
        let itemId: string;

        beforeEach(async () => {
            ctx = await setup(db);
            ({ es } = ctx);
            schema = makeTestSchema();
            const rec = await es.create(ctx, schema, { name: "Colls" });
            itemId = rec.id;
        });
        afterEach(async () => {
            await teardown(ctx);
        });

        it("create() with an array property value populates collection via _propQuads", async () => {
            // Passing an array for a collection property hits the Array.isArray branch in _propQuads
            const rec = await es.create(ctx, schema, { name: "WithTags", tags: ["x", "y", "z"] });
            const found = await es.findById(ctx, schema, rec.id, [TestCoreHandle]);
            expect(found?.groups[TestCoreHandle.id]?.tags).toEqual(["x", "y", "z"]);
        });

        it("collectionGet returns empty array before any push", async () => {
            const tags = await es.collectionGet(ctx, schema, itemId, TestCoreHandle, "tags");
            expect(tags).toEqual([]);
        });

        it("collectionPush appends values in insertion order", async () => {
            await es.collectionPush(
                ctx,
                schema,
                itemId,
                TestCoreHandle,
                "tags",
                "alpha",
                "beta",
                "gamma",
            );
            const tags = await es.collectionGet(ctx, schema, itemId, TestCoreHandle, "tags");
            expect(tags).toEqual(["alpha", "beta", "gamma"]);
        });

        it("collectionRemove deletes a specific value", async () => {
            await es.collectionPush(ctx, schema, itemId, TestCoreHandle, "tags", "a", "b", "c");
            const removed = await es.collectionRemove(
                ctx,
                schema,
                itemId,
                TestCoreHandle,
                "tags",
                "b",
            );
            expect(removed).toBe(true);
            const tags = await es.collectionGet(ctx, schema, itemId, TestCoreHandle, "tags");
            expect(tags).not.toContain("b");
            expect(tags).toContain("a");
            expect(tags).toContain("c");
        });

        it("collectionRemove returns false when value not present", async () => {
            const removed = await es.collectionRemove(
                ctx,
                schema,
                itemId,
                TestCoreHandle,
                "tags",
                "ghost",
            );
            expect(removed).toBe(false);
        });

        it("collectionPop removes and returns the last item", async () => {
            await es.collectionPush(
                ctx,
                schema,
                itemId,
                TestCoreHandle,
                "tags",
                "first",
                "second",
                "third",
            );
            const last = await es.collectionPop(ctx, schema, itemId, TestCoreHandle, "tags");
            expect(last).toBe("third");
            const tags = await es.collectionGet(ctx, schema, itemId, TestCoreHandle, "tags");
            expect(tags).toEqual(["first", "second"]);
        });

        it("collectionPop on empty returns undefined", async () => {
            const last = await es.collectionPop(ctx, schema, itemId, TestCoreHandle, "tags");
            expect(last).toBeUndefined();
        });

        it("collectionSet replaces entire collection", async () => {
            await es.collectionPush(ctx, schema, itemId, TestCoreHandle, "tags", "x", "y");
            await es.collectionSet(ctx, schema, itemId, TestCoreHandle, "tags", ["p", "q", "r"]);
            const tags = await es.collectionGet(ctx, schema, itemId, TestCoreHandle, "tags");
            expect(tags).toEqual(["p", "q", "r"]);
        });

        it("collectionSet with empty array clears the collection", async () => {
            await es.collectionPush(ctx, schema, itemId, TestCoreHandle, "tags", "tag1");
            await es.collectionSet(ctx, schema, itemId, TestCoreHandle, "tags", []);
            const tags = await es.collectionGet(ctx, schema, itemId, TestCoreHandle, "tags");
            expect(tags).toEqual([]);
        });

        it("collectionInsertAt inserts at the beginning", async () => {
            await es.collectionPush(ctx, schema, itemId, TestCoreHandle, "tags", "b", "c");
            await es.collectionInsertAt(ctx, schema, itemId, TestCoreHandle, "tags", 0, "a");
            const tags = await es.collectionGet(ctx, schema, itemId, TestCoreHandle, "tags");
            expect(tags).toEqual(["a", "b", "c"]);
        });

        it("collectionInsertAt inserts in the middle", async () => {
            await es.collectionPush(ctx, schema, itemId, TestCoreHandle, "tags", "a", "c");
            await es.collectionInsertAt(ctx, schema, itemId, TestCoreHandle, "tags", 1, "b");
            const tags = await es.collectionGet(ctx, schema, itemId, TestCoreHandle, "tags");
            expect(tags).toEqual(["a", "b", "c"]);
        });

        it("collectionInsertAt appends when index exceeds length", async () => {
            await es.collectionPush(ctx, schema, itemId, TestCoreHandle, "tags", "one", "two");
            await es.collectionInsertAt(ctx, schema, itemId, TestCoreHandle, "tags", 99, "three");
            const tags = await es.collectionGet(ctx, schema, itemId, TestCoreHandle, "tags");
            expect(tags).toEqual(["one", "two", "three"]);
        });

        it("sorting a collection via collectionSet", async () => {
            await es.collectionPush(
                ctx,
                schema,
                itemId,
                TestCoreHandle,
                "tags",
                "gamma",
                "alpha",
                "beta",
            );
            const current = (await es.collectionGet(
                ctx,
                schema,
                itemId,
                TestCoreHandle,
                "tags",
            )) as string[];
            const sorted = [...current].sort();
            await es.collectionSet(ctx, schema, itemId, TestCoreHandle, "tags", sorted);
            const tags = await es.collectionGet(ctx, schema, itemId, TestCoreHandle, "tags");
            expect(tags).toEqual(["alpha", "beta", "gamma"]);
        });

        it("hydrated findById returns collection as array", async () => {
            await es.collectionPush(ctx, schema, itemId, TestCoreHandle, "tags", "x", "y", "z");
            const found = await es.findById(ctx, schema, itemId, [TestCoreHandle]);
            expect(found?.groups[TestCoreHandle.id]?.tags).toEqual(["x", "y", "z"]);
        });
    });

    // ── EntityValidationError ─────────────────────────────────────────────────

    describe(`EntityValidationError (${db.name})`, () => {
        let ctx: Awaited<ReturnType<typeof setup>>;

        beforeEach(async () => {
            ctx = await setup(db);
        });
        afterEach(async () => {
            await teardown(ctx);
        });

        it("carries structured violations", () => {
            const err = new EntityValidationError([
                { property: "email", value: "", message: "Required.", severity: "violation" },
            ]);
            expect(err).toBeInstanceOf(Error);
            expect(err.violations).toHaveLength(1);
            expect(err.violations[0]?.property).toBe("email");
        });

        it("message includes the property name", () => {
            const err = new EntityValidationError([
                { property: "email", value: "", message: "Required.", severity: "violation" },
            ]);
            expect(err.message).toContain("email");
        });
    });
}

// ── Non-DB tests (handle utilities, EntitySchema, util helpers) ───────────────

describe("handleSlug", () => {
    it("replaces colons with underscores and appends version", () => {
        const h = handle("test:core");
        expect(handleSlug(h)).toBe("test_core_v1");
    });

    it("works for handles with dots", () => {
        const h = handle("com.acme.billing", 2);
        expect(handleSlug(h)).toBe("com.acme.billing_v2");
    });
});

describe("EntitySchema — resolveGroups", () => {
    it("returns all groups when handle is *", () => {
        const schema = makeTestSchema();
        const groups = schema.resolveGroups("*");
        expect(groups.length).toBeGreaterThanOrEqual(2);
    });

    it("returns empty array for unregistered handle", () => {
        const schema = makeTestSchema();
        const unknown = handle("totally:unknown");
        const groups = schema.resolveGroups([unknown]);
        expect(groups).toEqual([]);
    });

    it("returns subset for a list of known handles", () => {
        const schema = makeTestSchema();
        const groups = schema.resolveGroups([TestCoreHandle]);
        expect(groups).toHaveLength(1);
        expect(groups[0]?.handle.id).toBe(TestCoreHandle.id);
    });
});

describe("EntityStore — defensive throw paths", () => {
    let knex: import("knex").Knex;
    let es: EntityStore;
    let schema: EntitySchema;
    let itemId: string;

    beforeEach(async () => {
        knex = await createDataContext({ client: "sqlite", filename: ":memory:" });
        es = new EntityStore(new TripleStore(knex));
        schema = makeTestSchema();
        const rec = await es.create(defaultServerContext, schema, { name: "Item" });
        itemId = rec.id;
    });
    afterEach(async () => {
        await knex.destroy();
    });

    it("collectionSet throws when prop not in schema (line 311)", async () => {
        await expect(
            es.collectionSet(defaultServerContext, schema, itemId, TestCoreHandle, "nonExistentProp", ["x"]),
        ).rejects.toThrow();
    });

    it("createCollectionView throws when prop not in schema (line 363)", async () => {
        await expect(
            es.createCollectionView(defaultServerContext, schema, itemId, TestCoreHandle, "nonExistentProp"),
        ).rejects.toThrow();
    });

    it("collectionPush throws when handle not registered on schema (line 466)", async () => {
        const ghostHandle = handle("ghost:handle");
        await expect(
            es.collectionPush(defaultServerContext, schema, itemId, ghostHandle, "member", "val"),
        ).rejects.toThrow("PropGroup not registered on schema");
    });
});

describe("EntityStore — views getter", () => {
    it("es.views returns a CollectionViewStore instance", async () => {
        const knex = await createDataContext({ client: "sqlite", filename: ":memory:" });
        const store = new TripleStore(knex);
        const es = new EntityStore(store);
        expect(es.views).toBeDefined();
        await knex.destroy();
    });
});

describe("EntityStore — collectionGet/Remove with unknown prop returns early", () => {
    let knex: import("knex").Knex;
    let es: EntityStore;
    let schema: EntitySchema;
    let itemId: string;

    beforeEach(async () => {
        knex = await createDataContext({ client: "sqlite", filename: ":memory:" });
        es = new EntityStore(new TripleStore(knex));
        schema = makeTestSchema();
        const rec = await es.create(defaultServerContext, schema, { name: "Item" });
        itemId = rec.id;
    });
    afterEach(async () => {
        await knex.destroy();
    });

    it("collectionGet returns [] when prop is not in the group", async () => {
        const result = await es.collectionGet(defaultServerContext, schema, itemId, TestCoreHandle, "unknownProp");
        expect(result).toEqual([]);
    });

    it("collectionRemove returns false when prop is not in the group", async () => {
        const removed = await es.collectionRemove(
            defaultServerContext,
            schema,
            itemId,
            TestCoreHandle,
            "unknownProp",
            "value",
        );
        expect(removed).toBe(false);
    });

    it("collectionPush throws when prop is not in the group", async () => {
        await expect(
            es.collectionPush(defaultServerContext, schema, itemId, TestCoreHandle, "unknownProp", "value"),
        ).rejects.toThrow("unknownProp");
    });
});

describe("EntityStore — inTransaction wraps work in a DB transaction", () => {
    it("executes fn inside a knex transaction and returns result", async () => {
        const knex = await createDataContext({ client: "sqlite", filename: ":memory:" });
        const store = new TripleStore(knex);
        const es = new EntityStore(store);
        const schema = makeTestSchema();

        const result = await es.inTransaction(async (ctx) => {
            return es.create(ctx, schema, { name: "TxItem" });
        });

        expect(result.id).toBeTruthy();
        const found = await es.findById(defaultServerContext, schema, result.id, [TestCoreHandle]);
        expect(found?.groups[TestCoreHandle.id]?.name).toBe("TxItem");
        await knex.destroy();
    });
});

describe("EntityStore._validate — schema with shape", () => {
    const nameIRI = new IRI("http://test.dev/name");
    const schemaWithShape = new EntitySchema({
        typeIRI: new IRI("http://test.dev/ValidatedItem"),
        ns: "http://test.dev/",
        coreGroup: {
            handle: handle("test:validated"),
            properties: { name: nameIRI },
            shape: {
                iri: "http://test.dev/ValidatedItemShape",
                targetClass: "http://test.dev/ValidatedItem",
                closed: false,
                properties: [{ path: "http://test.dev/name", minCount: 1 }],
            } satisfies ShaclNodeShape,
        },
    });

    it("validates successfully when required prop is present (covers line 472-473 valid=true)", async () => {
        const knex = await createDataContext({ client: "sqlite", filename: ":memory:" });
        const store = new TripleStore(knex);
        const es = new EntityStore(store);
        // Should NOT throw — name is provided
        const rec = await es.create(defaultServerContext, schemaWithShape, { name: "ValidName" });
        expect(rec.id).toBeTruthy();
        await knex.destroy();
    });

    it("throws EntityValidationError when required prop missing (covers line 473 throw branch)", async () => {
        const knex = await createDataContext({ client: "sqlite", filename: ":memory:" });
        const store = new TripleStore(knex);
        const es = new EntityStore(store);
        // Should throw — name is missing and minCount=1
        await expect(es.create(defaultServerContext, schemaWithShape, {})).rejects.toBeInstanceOf(
            EntityValidationError,
        );
        await knex.destroy();
    });
});

describe("fromLiteral — utility branches", () => {
    it("returns the value for a BlankNode term", () => {
        const result = fromLiteral({ termType: "BlankNode", id: "b0", value: "b0" });
        expect(result).toBe("b0");
    });

    it("returns undefined for unknown term shape", () => {
        expect(fromLiteral(null)).toBeUndefined();
        expect(fromLiteral(42)).toBeUndefined();
    });
});

describe("invertPropertyMap / propertyMapFor", () => {
    const props = { name: new IRI("http://x/name"), score: new IRI("http://x/score") };

    it("invertPropertyMap maps IRI string → property name", () => {
        const inv = invertPropertyMap(props);
        expect(inv.get("http://x/name")).toBe("name");
        expect(inv.get("http://x/score")).toBe("score");
    });

    it("propertyMapFor maps property name → IRI string", () => {
        const map = propertyMapFor(props);
        expect(map.name).toBe("http://x/name");
        expect(map.score).toBe("http://x/score");
    });
});

// ── EntityQuery filter operators (non-equality) — runs per DB provider ─────────

for (const db of providers) {
    describe(`EntityQuery — filter operators (${db.name})`, () => {
        let ctx: Awaited<ReturnType<typeof setup>>;
        let es: EntityStore;
        let schema: EntitySchema;

        beforeEach(async () => {
            ctx = await setup(db);
            ({ es } = ctx);
            schema = makeTestSchema();
            // Create three entities with known scores and names
            await es.create(ctx, schema, { name: "Alice", score: 10 });
            await es.create(ctx, schema, { name: "Bob", score: 20 });
            await es.create(ctx, schema, { name: "Charlie", score: 30 });
        });
        afterEach(async () => {
            await teardown(ctx);
        });

        it("!= excludes the matching record", async () => {
            const results = await entities(ctx.store)
                .find(schema, [TestCoreHandle])
                .where(TestCoreHandle, "score", "!=", 20)
                .all(ctx);
            const scores = results.map((r) => r.groups[TestCoreHandle.id]?.score);
            expect(scores).not.toContain(20);
            expect(scores).toHaveLength(2);
        });

        it("< returns records below the threshold", async () => {
            const results = await entities(ctx.store)
                .find(schema, [TestCoreHandle])
                .where(TestCoreHandle, "score", "<", 20)
                .all(ctx);
            const scores = results.map((r) => r.groups[TestCoreHandle.id]?.score);
            expect(scores).toEqual([10]);
        });

        it("<= returns records at or below the threshold", async () => {
            const results = await entities(ctx.store)
                .find(schema, [TestCoreHandle])
                .where(TestCoreHandle, "score", "<=", 20)
                .all(ctx);
            const scores = results.map((r) => r.groups[TestCoreHandle.id]?.score);
            expect(scores).toContain(10);
            expect(scores).toContain(20);
            expect(scores).not.toContain(30);
        });

        it("> returns records above the threshold", async () => {
            const results = await entities(ctx.store)
                .find(schema, [TestCoreHandle])
                .where(TestCoreHandle, "score", ">", 10)
                .all(ctx);
            const scores = results.map((r) => r.groups[TestCoreHandle.id]?.score);
            expect(scores).toContain(20);
            expect(scores).toContain(30);
            expect(scores).not.toContain(10);
        });

        it(">= returns records at or above the threshold", async () => {
            const results = await entities(ctx.store)
                .find(schema, [TestCoreHandle])
                .where(TestCoreHandle, "score", ">=", 20)
                .all(ctx);
            const scores = results.map((r) => r.groups[TestCoreHandle.id]?.score);
            expect(scores).toContain(20);
            expect(scores).toContain(30);
            expect(scores).not.toContain(10);
        });

        it("LIKE pattern matches names starting with prefix", async () => {
            const results = await entities(ctx.store)
                .find(schema, [TestCoreHandle])
                .where(TestCoreHandle, "name", "LIKE", "Ali%")
                .all(ctx);
            expect(results).toHaveLength(1);
            expect(results[0]?.groups[TestCoreHandle.id]?.name).toBe("Alice");
        });

        it("ILIKE pattern is case-insensitive", async () => {
            const results = await entities(ctx.store)
                .find(schema, [TestCoreHandle])
                .where(TestCoreHandle, "name", "ILIKE", "ali%")
                .all(ctx);
            expect(results).toHaveLength(1);
            expect(results[0]?.groups[TestCoreHandle.id]?.name).toBe("Alice");
        });

        it(".store getter returns a TripleStore", () => {
            const q = entities(ctx.store).find(schema, "*");
            expect(q.store).toBe(ctx.store);
        });

        it("where() with an unknown handle returns all entities (no filtering)", async () => {
            const unknownHandle = handle("totally:unknown");
            const results = await entities(ctx.store)
                .find(schema, [TestCoreHandle])
                .where(unknownHandle, "score", "=", 10)
                .all(ctx);
            // unknown handle → group not found → early return iris as-is
            expect(results.length).toBe(3);
        });

        it("_matchFilter default branch: unknown operator returns false", async () => {
            // Force the unreachable `default` branch by casting a bad operator via `any`
            const results = await entities(ctx.store)
                .find(schema, [TestCoreHandle])
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .where(
                    TestCoreHandle,
                    "score",
                    "BOGUS" as unknown as "=" | "!=" | "<" | "<=" | ">" | ">=",
                    10,
                )
                .all(ctx);
            // default returns false → no records match → filtered to 0
            expect(results.length).toBe(0);
        });

        it("Handle Symbol.toPrimitive is exercised in template literals", () => {
            const str = `${TestCoreHandle}`;
            expect(str).toContain("test:core");
        });

        it("_applyEqFilter: unknown prop on a known handle skips filtering", async () => {
            // The handle is known but the prop name doesn't exist → propIri is undefined
            const results = await entities(ctx.store)
                .find(schema, [TestCoreHandle])
                .where(TestCoreHandle, "nonexistentProp", "=", "anything")
                .all(ctx);
            // No propIri → returns all iris unchanged
            expect(results.length).toBe(3);
        });

        it("_matchFilter: record missing the filter handle returns false", async () => {
            // Use a non-equality filter with a handle not in the record's groups
            // The record has TestCoreHandle but not TestExtHandle
            const results = await entities(ctx.store)
                .find(schema, [TestCoreHandle])
                .where(TestExtHandle, "active", "!=", false)
                .all(ctx);
            // _matchFilter returns false (groupData undefined) → no records pass
            expect(results.length).toBe(0);
        });
    });

    // Dedicated sort-branch test with a fresh describe to control insertion order
    describe(`EntityQuery — orderBy bv==null branch (${db.name})`, () => {
        let ctx: Awaited<ReturnType<typeof setup>>;
        let es: EntityStore;
        let schema: EntitySchema;

        beforeEach(async () => {
            ctx = await setup(db);
            ({ es } = ctx);
            schema = makeTestSchema();
            // Insert entity WITH email FIRST so it's element[0] in the sort input,
            // forcing the comparator to see av='a@test' and bv=null
            await es.create(ctx, schema, { name: "HasEmail", email: "a@test.com", score: 1 });
            await es.create(ctx, schema, { name: "NoEmail", score: 2 });
        });
        afterEach(async () => {
            await teardown(ctx);
        });

        it("bv==null: element-with-value appears before element-without → cmp=1 branch", async () => {
            const results = await entities(ctx.store)
                .find(schema, [TestCoreHandle])
                .orderBy(TestCoreHandle, "email", "asc")
                .all(ctx);
            expect(results).toHaveLength(2);
            // NoEmail should come first in ascending sort (null < any value)
            expect(results[0]?.groups[TestCoreHandle.id]?.name).toBe("NoEmail");
            expect(results[1]?.groups[TestCoreHandle.id]?.name).toBe("HasEmail");
        });
    });
}
