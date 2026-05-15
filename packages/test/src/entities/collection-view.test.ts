/**
 * CollectionView integration tests.
 *
 * Scenario: A Group entity has a `members` collection whose values are User
 * entity IRI strings.  A CollectionView is created over that collection and
 * automatically tracks additions and removals.
 *
 * Covers:
 *   - createCollectionView() + getView()
 *   - Auto-update on collectionPush
 *   - Auto-update on collectionRemove
 *   - Explicit addItem / removeItem on CollectionViewStore
 *   - reorder()
 *   - sortProp (resolves via PropGroup two-hop for entity refs)
 *   - sync()
 *   - Multiple views on the same source collection
 *   - delete() cleans up all nodes
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
    CollectionViewStore,
} from '@system/entities';


// ── Provider matrix ───────────────────────────────────────────────────────────

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

// ── Test schema: Group with a members collection ──────────────────────────────

const GroupHandle   = handle('test:group');
const memberIRI     = new IRI('http://test.dev/group/member');
const groupNameIRI  = new IRI('http://test.dev/group/name');

function makeGroupSchema() {
    return new EntitySchema({
        typeIRI:   new IRI('http://test.dev/group/Group'),
        ns:        'http://test.dev/group/',
        coreGroup: {
            handle:     GroupHandle,
            properties: { name: groupNameIRI, member: memberIRI },
        },
    });
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

async function setup(db: DbProvider) {
    const knex  = await db.create();
    const trx   = await knex.transaction();
    const store = new TripleStore(trx as unknown as Knex);
    const es    = new EntityStore(store);
    const cvs   = new CollectionViewStore(store);
    return { knex, trx, store, es, cvs };
}

async function teardown(ctx: Awaited<ReturnType<typeof setup>>) {
    await ctx.trx.rollback();
    await ctx.knex.destroy();
}


// ─────────────────────────────────────────────────────────────────────────────

for (const db of providers) {

    // ── Basic create + read ───────────────────────────────────────────────────

    describe(`CollectionView — basic (${db.name})`, () => {
        let ctx: Awaited<ReturnType<typeof setup>>;
        let schema: EntitySchema;
        let groupId: string;

        beforeEach(async () => {
            ctx    = await setup(db);
            schema = makeGroupSchema();
            const g = await ctx.es.create(schema, { name: 'Engineering' });
            groupId = g.id;
        });
        afterEach(() => teardown(ctx));

        it('createCollectionView on empty collection returns empty items', async () => {
            const viewIri = await ctx.es.createCollectionView(schema, groupId, GroupHandle, 'member');
            const view    = await ctx.cvs.getView(viewIri);
            expect(view).not.toBeNull();
            expect(view!.items).toHaveLength(0);
            expect(view!.sourcePg).toContain('http://test.dev/group/');
            expect(view!.prop).toBe(memberIRI.value);
        });

        it('createCollectionView on populated collection pre-fills items', async () => {
            await ctx.es.collectionPush(schema, groupId, GroupHandle, 'member', 'alice', 'bob', 'carol');
            const viewIri = await ctx.es.createCollectionView(schema, groupId, GroupHandle, 'member');
            const view    = await ctx.cvs.getView(viewIri);
            expect(view!.items).toHaveLength(3);
            expect(view!.items.map(i => i.ref)).toEqual(['alice', 'bob', 'carol']);
        });

        it('getView returns items in position order (ascending)', async () => {
            await ctx.es.collectionPush(schema, groupId, GroupHandle, 'member', 'z', 'm', 'a');
            const viewIri = await ctx.es.createCollectionView(schema, groupId, GroupHandle, 'member');
            const view    = await ctx.cvs.getView(viewIri);
            // Items are in insertion order, not alphabetical
            expect(view!.items.map(i => i.ref)).toEqual(['z', 'm', 'a']);
        });

        it('getView returns null for unknown viewIri', async () => {
            const view = await ctx.cvs.getView('http://tern.dev/ns/core/view/no-such-view');
            expect(view).toBeNull();
        });
    });


    // ── Auto-update on collection mutations ───────────────────────────────────

    describe(`CollectionView — auto-update (${db.name})`, () => {
        let ctx: Awaited<ReturnType<typeof setup>>;
        let schema: EntitySchema;
        let groupId: string;
        let viewIri: string;

        beforeEach(async () => {
            ctx    = await setup(db);
            schema = makeGroupSchema();
            const g = await ctx.es.create(schema, { name: 'Dev' });
            groupId = g.id;
            viewIri = await ctx.es.createCollectionView(schema, groupId, GroupHandle, 'member');
        });
        afterEach(() => teardown(ctx));

        it('collectionPush adds item to registered view', async () => {
            await ctx.es.collectionPush(schema, groupId, GroupHandle, 'member', 'alice');
            const view = await ctx.cvs.getView(viewIri);
            expect(view!.items).toHaveLength(1);
            expect(view!.items[0]!.ref).toBe('alice');
        });

        it('collectionPush with multiple values adds all items', async () => {
            await ctx.es.collectionPush(schema, groupId, GroupHandle, 'member', 'alice', 'bob');
            const view = await ctx.cvs.getView(viewIri);
            expect(view!.items).toHaveLength(2);
            expect(view!.items.map(i => i.ref)).toContain('alice');
            expect(view!.items.map(i => i.ref)).toContain('bob');
        });

        it('collectionRemove removes item from registered view', async () => {
            await ctx.es.collectionPush(schema, groupId, GroupHandle, 'member', 'alice', 'bob', 'carol');
            await ctx.es.collectionRemove(schema, groupId, GroupHandle, 'member', 'bob');
            const view = await ctx.cvs.getView(viewIri);
            expect(view!.items).toHaveLength(2);
            expect(view!.items.map(i => i.ref)).not.toContain('bob');
        });

        it('collectionPush is idempotent in view (same ref not added twice)', async () => {
            await ctx.es.collectionPush(schema, groupId, GroupHandle, 'member', 'alice');
            await ctx.cvs.addItem(viewIri, 'alice'); // explicit duplicate attempt
            const view = await ctx.cvs.getView(viewIri);
            expect(view!.items).toHaveLength(1);
        });
    });


    // ── Direct CollectionViewStore operations ─────────────────────────────────

    describe(`CollectionViewStore — direct ops (${db.name})`, () => {
        let ctx: Awaited<ReturnType<typeof setup>>;
        let viewIri: string;

        beforeEach(async () => {
            ctx = await setup(db);
            viewIri = await ctx.cvs.create('http://test/pg', 'http://test/prop',
                ['alpha', 'beta', 'gamma']);
        });
        afterEach(() => teardown(ctx));

        it('getView returns correct metadata', async () => {
            const view = await ctx.cvs.getView(viewIri);
            expect(view!.sourcePg).toBe('http://test/pg');
            expect(view!.prop).toBe('http://test/prop');
        });

        it('addItem appends to the end', async () => {
            await ctx.cvs.addItem(viewIri, 'delta');
            const view = await ctx.cvs.getView(viewIri);
            expect(view!.items).toHaveLength(4);
            expect(view!.items[3]!.ref).toBe('delta');
        });

        it('removeItem removes the matching item', async () => {
            const removed = await ctx.cvs.removeItem(viewIri, 'beta');
            expect(removed).toBe(true);
            const view = await ctx.cvs.getView(viewIri);
            expect(view!.items).toHaveLength(2);
            expect(view!.items.map(i => i.ref)).not.toContain('beta');
        });

        it('removeItem returns false for unknown ref', async () => {
            const removed = await ctx.cvs.removeItem(viewIri, 'no-such-value');
            expect(removed).toBe(false);
        });

        it('reorder updates positions', async () => {
            await ctx.cvs.reorder(viewIri, ['gamma', 'alpha', 'beta']);
            const view = await ctx.cvs.getView(viewIri);
            expect(view!.items.map(i => i.ref)).toEqual(['gamma', 'alpha', 'beta']);
        });

        it('sync adds new refs and removes stale ones', async () => {
            await ctx.cvs.sync(viewIri, ['alpha', 'gamma', 'epsilon']);
            const view = await ctx.cvs.getView(viewIri);
            const refs = view!.items.map(i => i.ref);
            expect(refs).toContain('alpha');
            expect(refs).toContain('gamma');
            expect(refs).toContain('epsilon');
            expect(refs).not.toContain('beta'); // removed because not in new snapshot
        });

        it('delete removes view and all CollectionViewItem nodes', async () => {
            await ctx.cvs.delete(viewIri);
            const view = await ctx.cvs.getView(viewIri);
            expect(view).toBeNull();
        });
    });


    // ── Sort by property on referenced entities ────────────────────────────────

    describe(`CollectionView — sortProp (${db.name})`, () => {
        let ctx: Awaited<ReturnType<typeof setup>>;
        let schema: EntitySchema;
        let groupId: string;

        beforeEach(async () => {
            ctx    = await setup(db);
            schema = makeGroupSchema();

            // Create User entities with displayNames in unsorted order
            const charlie = await ctx.es.create(UserSchema, { email: 'c@test.com', displayName: 'Charlie' });
            const alice   = await ctx.es.create(UserSchema, { email: 'a@test.com', displayName: 'Alice' });
            const bob     = await ctx.es.create(UserSchema, { email: 'b@test.com', displayName: 'Bob' });

            // Create a Group and add users by their entity IRIs
            const g = await ctx.es.create(schema, { name: 'Sorted Group' });
            groupId = g.id;
            await ctx.es.collectionPush(schema, groupId, GroupHandle, 'member',
                charlie.iri, alice.iri, bob.iri);
        });
        afterEach(() => teardown(ctx));

        it('sortProp asc sorts items by property on referenced entity', async () => {
            const displayNameIRI = new IRI('http://tern.dev/ns/auth/displayName');
            const viewIri = await ctx.es.createCollectionView(schema, groupId, GroupHandle, 'member', {
                sortProp: displayNameIRI,
                sortDir:  'asc',
            });
            const view = await ctx.cvs.getView(viewIri);
            // Insertion order was charlie, alice, bob — asc sort by displayName → Alice, Bob, Charlie
            const refs = view!.items.map(i => i.ref);
            // We stored entity IRIs. Find them by querying back from the UserSchema.
            const aliceRec   = await ctx.es.findById(UserSchema, refs.find(r => r)!, '*');
            // Instead of guessing which IRI is which, verify that adjacent sorted pairs
            // have displayNames in asc order: refs[0].displayName <= refs[1].displayName
            for (let i = 0; i < refs.length - 1; i++) {
                const a = await ctx.es.findById(UserSchema, refs[i]!.split('/').pop()!, '*');
                const b = await ctx.es.findById(UserSchema, refs[i + 1]!.split('/').pop()!, '*');
                const aDN = String(a?.groups[CoreHandle.id]?.['displayName'] ?? '');
                const bDN = String(b?.groups[CoreHandle.id]?.['displayName'] ?? '');
                expect(aDN <= bDN).toBe(true);
            }
        });

        it('sortProp desc reverses the sort', async () => {
            const displayNameIRI = new IRI('http://tern.dev/ns/auth/displayName');
            const viewIri = await ctx.es.createCollectionView(schema, groupId, GroupHandle, 'member', {
                sortProp: displayNameIRI,
                sortDir:  'desc',
            });
            const view = await ctx.cvs.getView(viewIri);
            const refs = view!.items.map(i => i.ref);
            // Verify desc ordering: each adjacent pair should have displayName descending
            for (let i = 0; i < refs.length - 1; i++) {
                const a = await ctx.es.findById(UserSchema, refs[i]!.split('/').pop()!, '*');
                const b = await ctx.es.findById(UserSchema, refs[i + 1]!.split('/').pop()!, '*');
                const aDN = String(a?.groups[CoreHandle.id]?.['displayName'] ?? '');
                const bDN = String(b?.groups[CoreHandle.id]?.['displayName'] ?? '');
                expect(aDN >= bDN).toBe(true);
            }
        });

        it('sortProp stores config on the view', async () => {
            const displayNameIRI = new IRI('http://tern.dev/ns/auth/displayName');
            const viewIri = await ctx.es.createCollectionView(schema, groupId, GroupHandle, 'member', {
                sortProp: displayNameIRI,
                sortDir:  'asc',
            });
            const view = await ctx.cvs.getView(viewIri);
            expect(view!.sortProp).toBe(displayNameIRI.value);
            expect(view!.sortDir).toBe('asc');
        });
    });


    // ── Multiple views on the same collection ─────────────────────────────────

    describe(`CollectionView — multiple views (${db.name})`, () => {
        let ctx: Awaited<ReturnType<typeof setup>>;
        let schema: EntitySchema;
        let groupId: string;
        let viewA: string;
        let viewB: string;

        beforeEach(async () => {
            ctx    = await setup(db);
            schema = makeGroupSchema();
            const g = await ctx.es.create(schema, { name: 'Multi-View Group' });
            groupId = g.id;
            viewA   = await ctx.es.createCollectionView(schema, groupId, GroupHandle, 'member');
            viewB   = await ctx.es.createCollectionView(schema, groupId, GroupHandle, 'member');
        });
        afterEach(() => teardown(ctx));

        it('both views receive the push', async () => {
            await ctx.es.collectionPush(schema, groupId, GroupHandle, 'member', 'alice');
            const va = await ctx.cvs.getView(viewA);
            const vb = await ctx.cvs.getView(viewB);
            expect(va!.items).toHaveLength(1);
            expect(vb!.items).toHaveLength(1);
        });

        it('both views lose the item on remove', async () => {
            await ctx.es.collectionPush(schema, groupId, GroupHandle, 'member', 'alice', 'bob');
            await ctx.es.collectionRemove(schema, groupId, GroupHandle, 'member', 'alice');
            const va = await ctx.cvs.getView(viewA);
            const vb = await ctx.cvs.getView(viewB);
            expect(va!.items).toHaveLength(1);
            expect(vb!.items).toHaveLength(1);
        });

        it('deleting one view leaves the other intact', async () => {
            await ctx.es.collectionPush(schema, groupId, GroupHandle, 'member', 'alice');
            await ctx.cvs.delete(viewA);
            expect(await ctx.cvs.getView(viewA)).toBeNull();
            const vb = await ctx.cvs.getView(viewB);
            expect(vb!.items).toHaveLength(1);
        });
    });


    // ── findViewsForSource ────────────────────────────────────────────────────

    describe(`CollectionViewStore.findViewsForSource (${db.name})`, () => {
        let ctx: Awaited<ReturnType<typeof setup>>;
        let schema: EntitySchema;

        beforeEach(async () => {
            ctx    = await setup(db);
            schema = makeGroupSchema();
        });
        afterEach(() => teardown(ctx));

        it('returns all view IRIs watching a given source + prop', async () => {
            const g1 = await ctx.es.create(schema, { name: 'G1' });
            const g2 = await ctx.es.create(schema, { name: 'G2' });
            const v1 = await ctx.es.createCollectionView(schema, g1.id, GroupHandle, 'member');
            const v2 = await ctx.es.createCollectionView(schema, g1.id, GroupHandle, 'member');
            const v3 = await ctx.es.createCollectionView(schema, g2.id, GroupHandle, 'member');

            // Read back v1's metadata so we get the exact sourcePg + prop the view stored
            const v1Record = await ctx.cvs.getView(v1);
            const { sourcePg, prop } = v1Record!;

            const views = await ctx.cvs.findViewsForSource(sourcePg, prop);
            // v1 and v2 both watch G1's members; v3 watches G2's members
            expect(views).toContain(v1);
            expect(views).toContain(v2);
            expect(views).not.toContain(v3);
        });

        it('returns empty array when no views watch the source', async () => {
            const views = await ctx.cvs.findViewsForSource(
                'http://nonexistent/pg',
                memberIRI.value,
            );
            expect(views).toHaveLength(0);
        });
    });
}
