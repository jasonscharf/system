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
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Knex } from 'knex';
import { IRI } from '@system/core';
import { createDataContext, TripleStore } from '@system/data';
import { UserSchema, CoreHandle } from '@system/auth';
import {
    handle,
    EntitySchema,
    EntityStore,
    entities,
    groupOf,
    EntityValidationError,
} from '@system/entities';


// ── Provider matrix (mirrors the pattern in triples.test.ts) ─────────────────

interface DbProvider { name: string; create(): Promise<Knex>; }

const providers: DbProvider[] = [
    { name: 'SQLite', create: () => createDataContext({ client: 'sqlite', filename: ':memory:' }) },
];

if (process.env['TERN_PG_URL']) {
    const url = new URL(process.env['TERN_PG_URL']);
    providers.push({
        name: 'Postgres',
        create: () => createDataContext({
            client: 'pg', host: url.hostname,
            port: url.port ? Number(url.port) : 5432,
            database: url.pathname.slice(1), user: url.username, password: url.password,
        }),
    });
}

// ── Test-specific schema (self-contained, no auth dependency for most tests) ──

const TestCoreHandle = handle('test:core');
const TestExtHandle  = handle('test:ext');

const nameIRI   = new IRI('http://test.dev/name');
const emailIRI  = new IRI('http://test.dev/email');
const scoreIRI  = new IRI('http://test.dev/score');
const activeIRI = new IRI('http://test.dev/active');
const tagIRI    = new IRI('http://test.dev/tag');
const rankIRI   = new IRI('http://test.dev/rank');

/**
 * Returns a fresh EntitySchema each time so register() calls in one test
 * don't leak into other tests.
 */
function makeTestSchema() {
    const schema = new EntitySchema({
        typeIRI:   new IRI('http://test.dev/Item'),
        ns:        'http://test.dev/',
        coreGroup: {
            handle:     TestCoreHandle,
            properties: { name: nameIRI, email: emailIRI, score: scoreIRI, tags: tagIRI },
            defaults:   { score: 0 },
        },
    });
    schema.register({
        handle:     TestExtHandle,
        properties: { active: activeIRI, rank: rankIRI },
        defaults:   { active: true },
    });
    return schema;
}


// ── Shared helper ─────────────────────────────────────────────────────────────

async function setup(db: DbProvider) {
    const knex  = await db.create();
    const trx   = await knex.transaction();
    const store = new TripleStore(trx as unknown as Knex);
    const es    = new EntityStore(store);
    return { knex, trx, store, es };
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

        beforeEach(async () => { ctx = await setup(db); });
        afterEach(async () => { await teardown(ctx); });

        it('creates a user and returns an id / iri', async () => {
            const rec = await ctx.es.create({}, UserSchema, { email: 'alice@example.com' });
            expect(rec.id).toBeTruthy();
            expect(rec.iri).toContain('http://tern.dev/ns/auth/user/');
            expect(rec.iri).toContain(rec.id);
        });

        it('applies createdAt / updatedAt defaults automatically', async () => {
            const rec  = await ctx.es.create({}, UserSchema, { email: 'bob@example.com' });
            const core = rec.groups[CoreHandle.id]!;
            expect(core['createdAt']).toBeInstanceOf(Date);
            expect(core['updatedAt']).toBeInstanceOf(Date);
        });

        it('findById returns the entity with correct props', async () => {
            const created = await ctx.es.create({}, UserSchema, { email: 'carol@example.com', displayName: 'Carol' });
            const found   = await ctx.es.findById(UserSchema, created.id, [CoreHandle]);
            const core    = found!.groups[CoreHandle.id]!;
            expect(core['email']).toBe('carol@example.com');
            expect(core['displayName']).toBe('Carol');
        });

        it('findById returns null for unknown id', async () => {
            expect(await ctx.es.findById(UserSchema, 'no-such-id', '*')).toBeNull();
        });

        it('updateGroup patches specific fields', async () => {
            const rec = await ctx.es.create({}, UserSchema, { email: 'd@example.com', displayName: 'Old' });
            await ctx.es.updateGroup({}, UserSchema, rec.id, CoreHandle, { displayName: 'New' });
            const updated = await ctx.es.findById(UserSchema, rec.id, [CoreHandle]);
            expect(updated!.groups[CoreHandle.id]!['displayName']).toBe('New');
            expect(updated!.groups[CoreHandle.id]!['email']).toBe('d@example.com'); // unchanged
        });

        it('delete removes the entity and all PropGroups', async () => {
            const rec = await ctx.es.create({}, UserSchema, { email: 'e@example.com' });
            await ctx.es.delete({}, UserSchema, rec.id);
            expect(await ctx.es.findById(UserSchema, rec.id, '*')).toBeNull();
        });

        it('addGroup attaches an extension PropGroup', async () => {
            const ExtHandle = handle('test:user-ext');
            const roleIRI   = new IRI('http://test.dev/role');
            UserSchema.register({ handle: ExtHandle, properties: { role: roleIRI } });

            const rec = await ctx.es.create({}, UserSchema, { email: 'f@example.com' });
            await ctx.es.addGroup({}, UserSchema, rec.id, ExtHandle, { role: 'admin' });

            const full = await ctx.es.findById(UserSchema, rec.id, '*');
            expect(full!.groups[ExtHandle.id]!['role']).toBe('admin');

            // Clean up — unregister is not supported, but the schema is shared so
            // we leave the registered handle in place (harmless, other tests use
            // their own schema instances via makeTestSchema()).
        });

        it('groupOf() helper narrows the type', async () => {
            const rec  = await ctx.es.create({}, UserSchema, { email: 'g@example.com' });
            const found = await ctx.es.findById(UserSchema, rec.id, [CoreHandle]);
            const core  = groupOf(found!, UserSchema.allGroups()[0]!);
            expect(core).toBeDefined();
            expect(core!['email']).toBe('g@example.com');
        });
    });


    // ── Default values ────────────────────────────────────────────────────────

    describe(`EntityStore — defaults (${db.name})`, () => {
        let ctx: Awaited<ReturnType<typeof setup>>;
        beforeEach(async () => { ctx = await setup(db); });
        afterEach(async () => { await teardown(ctx); });

        it('applies static defaults when property is absent', async () => {
            const schema = makeTestSchema();
            const rec    = await ctx.es.create({}, schema, { name: 'Widget' });
            expect(rec.groups[TestCoreHandle.id]!['score']).toBe(0);
        });

        it('does not override an explicitly supplied value', async () => {
            const schema = makeTestSchema();
            const rec    = await ctx.es.create({}, schema, { name: 'Widget', score: 99 });
            expect(rec.groups[TestCoreHandle.id]!['score']).toBe(99);
        });

        it('applies defaults from extension PropGroup on addGroup', async () => {
            const schema = makeTestSchema();
            const rec    = await ctx.es.create({}, schema, { name: 'Widget' });
            await ctx.es.addGroup({}, schema, rec.id, TestExtHandle, { rank: 5 });
            const found  = await ctx.es.findById(schema, rec.id, [TestExtHandle]);
            expect(found!.groups[TestExtHandle.id]!['active']).toBe(true);
            expect(found!.groups[TestExtHandle.id]!['rank']).toBe(5);
        });

        it('factory defaults produce independent values per entity', async () => {
            const rec1 = await ctx.es.create({}, UserSchema, { email: 'h1@example.com' });
            await new Promise(r => setTimeout(r, 5)); // ensure different timestamps
            const rec2 = await ctx.es.create({}, UserSchema, { email: 'h2@example.com' });

            const t1 = rec1.groups[CoreHandle.id]!['createdAt'] as Date;
            const t2 = rec2.groups[CoreHandle.id]!['createdAt'] as Date;
            expect(t1.getTime()).toBeLessThanOrEqual(t2.getTime());
        });
    });


    // ── EntityQuery: 1 filter ─────────────────────────────────────────────────

    describe(`EntityQuery — 1 filter (${db.name})`, () => {
        let ctx: Awaited<ReturnType<typeof setup>>;
        let schema: EntitySchema;

        beforeEach(async () => {
            ctx    = await setup(db);
            schema = makeTestSchema();
            await ctx.es.create({}, schema, { name: 'Alpha', email: 'alpha@example.com', score: 10 });
            await ctx.es.create({}, schema, { name: 'Beta',  email: 'beta@example.com',  score: 20 });
            await ctx.es.create({}, schema, { name: 'Gamma', email: 'gamma@example.com', score: 30 });
        });
        afterEach(async () => { await teardown(ctx); });

        it('finds entity by exact email match', async () => {
            const results = await entities(ctx.store)
                .find(schema, [TestCoreHandle])
                .where(TestCoreHandle, 'email', '=', 'beta@example.com')
                .all();
            expect(results).toHaveLength(1);
            expect(results[0]!.groups[TestCoreHandle.id]!['name']).toBe('Beta');
        });

        it('returns empty array when filter matches nothing', async () => {
            const results = await entities(ctx.store)
                .find(schema, [TestCoreHandle])
                .where(TestCoreHandle, 'email', '=', 'nobody@example.com')
                .all();
            expect(results).toHaveLength(0);
        });

        it('count() reflects filter', async () => {
            const n = await entities(ctx.store)
                .find(schema, [TestCoreHandle])
                .where(TestCoreHandle, 'email', '=', 'alpha@example.com')
                .count();
            expect(n).toBe(1);
        });

        it('first() returns one or null', async () => {
            const found = await entities(ctx.store)
                .find(schema, [TestCoreHandle])
                .where(TestCoreHandle, 'name', '=', 'Gamma')
                .first();
            expect(found).not.toBeNull();
            expect(found!.groups[TestCoreHandle.id]!['name']).toBe('Gamma');
        });

        it('limit() + offset() paginate correctly', async () => {
            const page = await entities(ctx.store)
                .find(schema, [TestCoreHandle])
                .limit(2)
                .all();
            expect(page).toHaveLength(2);

            const rest = await entities(ctx.store)
                .find(schema, [TestCoreHandle])
                .offset(2)
                .all();
            expect(rest).toHaveLength(1);
        });
    });


    // ── EntityQuery: 2 filters ────────────────────────────────────────────────

    describe(`EntityQuery — 2 filters (${db.name})`, () => {
        let ctx: Awaited<ReturnType<typeof setup>>;
        let schema: EntitySchema;

        beforeEach(async () => {
            ctx    = await setup(db);
            schema = makeTestSchema();
            const a = await ctx.es.create({}, schema, { name: 'Alice', email: 'a@example.com', score: 10 });
            const b = await ctx.es.create({}, schema, { name: 'Bob',   email: 'b@example.com', score: 20 });
            await ctx.es.addGroup({}, schema, a.id, TestExtHandle, { rank: 1, active: true  });
            await ctx.es.addGroup({}, schema, b.id, TestExtHandle, { rank: 2, active: false });
        });
        afterEach(async () => { await teardown(ctx); });

        it('intersects two equality filters across two PropGroups', async () => {
            const results = await entities(ctx.store)
                .find(schema, [TestCoreHandle, TestExtHandle])
                .where(TestCoreHandle, 'name',   '=', 'Alice')
                .where(TestExtHandle,  'active', '=', true)
                .all();
            expect(results).toHaveLength(1);
            expect(results[0]!.groups[TestCoreHandle.id]!['name']).toBe('Alice');
        });

        it('returns empty when filters exclude all entities', async () => {
            const results = await entities(ctx.store)
                .find(schema, [TestCoreHandle, TestExtHandle])
                .where(TestCoreHandle, 'name',   '=', 'Alice')
                .where(TestExtHandle,  'active', '=', false)  // Alice is active:true
                .all();
            expect(results).toHaveLength(0);
        });
    });


    // ── EntityQuery: 3 filters ────────────────────────────────────────────────

    describe(`EntityQuery — 3 filters (${db.name})`, () => {
        let ctx: Awaited<ReturnType<typeof setup>>;
        let schema: EntitySchema;

        beforeEach(async () => {
            ctx    = await setup(db);
            schema = makeTestSchema();
            const entities_ = [
                { name: 'P1', email: 'p1@ex.com', score: 10 },
                { name: 'P2', email: 'p2@ex.com', score: 20 },
                { name: 'P3', email: 'p3@ex.com', score: 30 },
            ];
            for (const [i, e] of entities_.entries()) {
                const rec = await ctx.es.create({}, schema, e);
                await ctx.es.addGroup({}, schema, rec.id, TestExtHandle, {
                    rank:   i + 1,
                    active: i !== 1, // P2 is inactive
                });
            }
        });
        afterEach(async () => { await teardown(ctx); });

        it('narrows to exactly one entity with 3 coincident conditions', async () => {
            const results = await entities(ctx.store)
                .find(schema, [TestCoreHandle, TestExtHandle])
                .where(TestCoreHandle, 'name',   '=', 'P3')
                .where(TestCoreHandle, 'score',  '=', 30)
                .where(TestExtHandle,  'active', '=', true)
                .all();
            expect(results).toHaveLength(1);
            expect(results[0]!.groups[TestCoreHandle.id]!['name']).toBe('P3');
        });

        it('excludes entities that fail any of the three conditions', async () => {
            const results = await entities(ctx.store)
                .find(schema, [TestCoreHandle, TestExtHandle])
                .where(TestCoreHandle, 'score',  '=', 20)   // only P2
                .where(TestExtHandle,  'active', '=', true)  // P2 is inactive
                .where(TestExtHandle,  'rank',   '=', 2)
                .all();
            expect(results).toHaveLength(0);
        });
    });


    // ── EntityQuery: sorting ──────────────────────────────────────────────────

    describe(`EntityQuery — sorting (${db.name})`, () => {
        let ctx: Awaited<ReturnType<typeof setup>>;
        let schema: EntitySchema;

        beforeEach(async () => {
            ctx    = await setup(db);
            schema = makeTestSchema();
            await ctx.es.create({}, schema, { name: 'Charlie', score: 30 });
            await ctx.es.create({}, schema, { name: 'Alice',   score: 10 });
            await ctx.es.create({}, schema, { name: 'Bob',     score: 20 });
        });
        afterEach(async () => { await teardown(ctx); });

        it('orderBy string field ascending', async () => {
            const results = await entities(ctx.store)
                .find(schema, [TestCoreHandle])
                .orderBy(TestCoreHandle, 'name', 'asc')
                .all();
            const names = results.map(r => r.groups[TestCoreHandle.id]!['name']);
            expect(names).toEqual(['Alice', 'Bob', 'Charlie']);
        });

        it('orderBy string field descending', async () => {
            const results = await entities(ctx.store)
                .find(schema, [TestCoreHandle])
                .orderBy(TestCoreHandle, 'name', 'desc')
                .all();
            const names = results.map(r => r.groups[TestCoreHandle.id]!['name']);
            expect(names).toEqual(['Charlie', 'Bob', 'Alice']);
        });

        it('orderBy numeric field ascending', async () => {
            const results = await entities(ctx.store)
                .find(schema, [TestCoreHandle])
                .orderBy(TestCoreHandle, 'score', 'asc')
                .all();
            const scores = results.map(r => r.groups[TestCoreHandle.id]!['score']);
            expect(scores).toEqual([10, 20, 30]);
        });

        it('orderBy combined with filter', async () => {
            await ctx.es.create({}, schema, { name: 'Dave', score: 10 });
            const results = await entities(ctx.store)
                .find(schema, [TestCoreHandle])
                .where(TestCoreHandle, 'score', '=', 10)
                .orderBy(TestCoreHandle, 'name', 'asc')
                .all();
            const names = results.map(r => r.groups[TestCoreHandle.id]!['name']);
            expect(names).toEqual(['Alice', 'Dave']);
        });
    });


    // ── Collection API ────────────────────────────────────────────────────────

    describe(`EntityStore — collections (${db.name})`, () => {
        let ctx: Awaited<ReturnType<typeof setup>>;
        let schema: EntitySchema;
        let itemId: string;

        beforeEach(async () => {
            ctx    = await setup(db);
            schema = makeTestSchema();
            const rec = await ctx.es.create({}, schema, { name: 'Colls' });
            itemId = rec.id;
        });
        afterEach(async () => { await teardown(ctx); });

        it('collectionGet returns empty array before any push', async () => {
            const tags = await ctx.es.collectionGet(schema, itemId, TestCoreHandle, 'tags');
            expect(tags).toEqual([]);
        });

        it('collectionPush appends values in insertion order', async () => {
            await ctx.es.collectionPush({}, schema, itemId, TestCoreHandle, 'tags', 'alpha', 'beta', 'gamma');
            const tags = await ctx.es.collectionGet(schema, itemId, TestCoreHandle, 'tags');
            expect(tags).toEqual(['alpha', 'beta', 'gamma']);
        });

        it('collectionRemove deletes a specific value', async () => {
            await ctx.es.collectionPush({}, schema, itemId, TestCoreHandle, 'tags', 'a', 'b', 'c');
            const removed = await ctx.es.collectionRemove({}, schema, itemId, TestCoreHandle, 'tags', 'b');
            expect(removed).toBe(true);
            const tags = await ctx.es.collectionGet(schema, itemId, TestCoreHandle, 'tags');
            expect(tags).not.toContain('b');
            expect(tags).toContain('a');
            expect(tags).toContain('c');
        });

        it('collectionRemove returns false when value not present', async () => {
            const removed = await ctx.es.collectionRemove({}, schema, itemId, TestCoreHandle, 'tags', 'ghost');
            expect(removed).toBe(false);
        });

        it('collectionPop removes and returns the last item', async () => {
            await ctx.es.collectionPush({}, schema, itemId, TestCoreHandle, 'tags', 'first', 'second', 'third');
            const last = await ctx.es.collectionPop({}, schema, itemId, TestCoreHandle, 'tags');
            expect(last).toBe('third');
            const tags = await ctx.es.collectionGet(schema, itemId, TestCoreHandle, 'tags');
            expect(tags).toEqual(['first', 'second']);
        });

        it('collectionPop on empty returns undefined', async () => {
            const last = await ctx.es.collectionPop({}, schema, itemId, TestCoreHandle, 'tags');
            expect(last).toBeUndefined();
        });

        it('collectionSet replaces entire collection', async () => {
            await ctx.es.collectionPush({}, schema, itemId, TestCoreHandle, 'tags', 'x', 'y');
            await ctx.es.collectionSet({}, schema, itemId, TestCoreHandle, 'tags', ['p', 'q', 'r']);
            const tags = await ctx.es.collectionGet(schema, itemId, TestCoreHandle, 'tags');
            expect(tags).toEqual(['p', 'q', 'r']);
        });

        it('collectionSet with empty array clears the collection', async () => {
            await ctx.es.collectionPush({}, schema, itemId, TestCoreHandle, 'tags', 'tag1');
            await ctx.es.collectionSet({}, schema, itemId, TestCoreHandle, 'tags', []);
            const tags = await ctx.es.collectionGet(schema, itemId, TestCoreHandle, 'tags');
            expect(tags).toEqual([]);
        });

        it('collectionInsertAt inserts at the beginning', async () => {
            await ctx.es.collectionPush({}, schema, itemId, TestCoreHandle, 'tags', 'b', 'c');
            await ctx.es.collectionInsertAt({}, schema, itemId, TestCoreHandle, 'tags', 0, 'a');
            const tags = await ctx.es.collectionGet(schema, itemId, TestCoreHandle, 'tags');
            expect(tags).toEqual(['a', 'b', 'c']);
        });

        it('collectionInsertAt inserts in the middle', async () => {
            await ctx.es.collectionPush({}, schema, itemId, TestCoreHandle, 'tags', 'a', 'c');
            await ctx.es.collectionInsertAt({}, schema, itemId, TestCoreHandle, 'tags', 1, 'b');
            const tags = await ctx.es.collectionGet(schema, itemId, TestCoreHandle, 'tags');
            expect(tags).toEqual(['a', 'b', 'c']);
        });

        it('collectionInsertAt appends when index exceeds length', async () => {
            await ctx.es.collectionPush({}, schema, itemId, TestCoreHandle, 'tags', 'one', 'two');
            await ctx.es.collectionInsertAt({}, schema, itemId, TestCoreHandle, 'tags', 99, 'three');
            const tags = await ctx.es.collectionGet(schema, itemId, TestCoreHandle, 'tags');
            expect(tags).toEqual(['one', 'two', 'three']);
        });

        it('sorting a collection via collectionSet', async () => {
            await ctx.es.collectionPush({}, schema, itemId, TestCoreHandle, 'tags', 'gamma', 'alpha', 'beta');
            const current = (await ctx.es.collectionGet(schema, itemId, TestCoreHandle, 'tags')) as string[];
            const sorted  = [...current].sort();
            await ctx.es.collectionSet({}, schema, itemId, TestCoreHandle, 'tags', sorted);
            const tags = await ctx.es.collectionGet(schema, itemId, TestCoreHandle, 'tags');
            expect(tags).toEqual(['alpha', 'beta', 'gamma']);
        });

        it('hydrated findById returns collection as array', async () => {
            await ctx.es.collectionPush({}, schema, itemId, TestCoreHandle, 'tags', 'x', 'y', 'z');
            const found = await ctx.es.findById(schema, itemId, [TestCoreHandle]);
            expect(found!.groups[TestCoreHandle.id]!['tags']).toEqual(['x', 'y', 'z']);
        });
    });


    // ── EntityValidationError ─────────────────────────────────────────────────

    describe(`EntityValidationError (${db.name})`, () => {
        let ctx: Awaited<ReturnType<typeof setup>>;

        beforeEach(async () => { ctx = await setup(db); });
        afterEach(async () => { await teardown(ctx); });

        it('carries structured violations', () => {
            const err = new EntityValidationError([
                { property: 'email', value: '', message: 'Required.', severity: 'violation' },
            ]);
            expect(err).toBeInstanceOf(Error);
            expect(err.violations).toHaveLength(1);
            expect(err.violations[0]!.property).toBe('email');
        });

        it('message includes the property name', () => {
            const err = new EntityValidationError([
                { property: 'email', value: '', message: 'Required.', severity: 'violation' },
            ]);
            expect(err.message).toContain('email');
        });
    });
}
