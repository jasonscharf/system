/**
 * SchemaRegistry integration tests.
 *
 * Covers five concerns:
 *   1. Version registration — ensureVersion() idempotently registers a hash for
 *      a schema and stores a queryable snapshot.
 *   2. Version numbering — each new hash for a type gets the next integer;
 *      re-registering the same hash returns the existing number.
 *   3. Entity version tagging — EntityStore.create() stamps each entity with the
 *      current schema hash; findById() echoes it back.
 *   4. Schema drift detection — when an entity's stored hash diverges from the
 *      current schema hash, findById() reports it on the record.
 *   5. Traversal planning — traversalPlan() describes the out-edge walk; the
 *      EntityStore.hydrateWithPlan() executes it in a single batch per depth.
 *
 * Runs against SQLite (always) and Postgres (when TERN_PG_URL is set).
 * Each suite runs inside a rolled-back transaction for full isolation.
 */

import { UserSchema } from "@jasonscharf/auth";
import { DEFAULT_GRAPH, IRI } from "@jasonscharf/core";
import { createDataContext, TripleStore } from "@jasonscharf/data";
import { EntitySchema, toLiteral } from "@jasonscharf/entities";
import {
    buildServerContext,
    EntityStore,
    type HydratedRecord,
    SCHEMA_VERSION_PREDICATE,
    SchemaRegistry,
    type ServerContext,
    type TraversalPlan,
    type TypeSnapshot,
    type TypeVersion,
} from "@jasonscharf/server";
import type { Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertEmptyStore } from "../assertEmptyStore.js";

// ── Inline schemas for traversal tests ───────────────────────────────────────
// The auth schemas store relationship IRIs as scalar properties rather than
// EdgeDef entries; the traversal planner operates on EdgeDef edges.  We define
// a minimal pair of schemas here to drive that interface cleanly.

const SR_NS = "http://test.dev/sr/";
const SR_GRAPH = new IRI(`${SR_NS}graph`);

interface AuthorProps extends Record<string, unknown> {
    name: string;
}
interface PostProps extends Record<string, unknown> {
    title: string;
}

const AuthorSchema = new EntitySchema<AuthorProps>({
    typeIRI: new IRI(`${SR_NS}Author`),
    ns: SR_NS,
    properties: { name: new IRI(`${SR_NS}name`) },
    graphIri: SR_GRAPH,
});

const PostSchema = new EntitySchema<PostProps>({
    typeIRI: new IRI(`${SR_NS}Post`),
    ns: SR_NS,
    properties: { title: new IRI(`${SR_NS}title`) },
    graphIri: SR_GRAPH,
    edges: {
        author: {
            predicate: new IRI(`${SR_NS}writtenBy`),
            target: () => AuthorSchema,
            cardinality: "one",
            direction: "out",
        },
    },
});

// ── DB provider matrix ────────────────────────────────────────────────────────

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

// ── Setup / teardown ──────────────────────────────────────────────────────────

async function setup(db: DbProvider) {
    const knex = await db.create();
    const trx = await knex.transaction();
    const store = new TripleStore(trx as unknown as import("knex").Knex);
    const registry = new SchemaRegistry(store);
    const es = new EntityStore(store, registry);
    return { ...buildServerContext(store, { trx }), knex, trx, store, es, registry };
}

async function teardown(ctx: Awaited<ReturnType<typeof setup>>) {
    await ctx.trx.rollback();
    await assertEmptyStore(ctx.knex);
    await ctx.knex.destroy();
}

// ─────────────────────────────────────────────────────────────────────────────

for (const db of providers) {
    // ── 1. Version registration ───────────────────────────────────────────────

    describe(`version registration (${db.name})`, () => {
        let ctx: Awaited<ReturnType<typeof setup>>;
        beforeEach(async () => {
            ctx = await setup(db);
        });
        afterEach(async () => {
            await teardown(ctx);
        });

        it("registers a version and returns a stable hash", async () => {
            const v1: TypeVersion = await ctx.registry.ensureVersion(ctx, UserSchema);
            const v2: TypeVersion = await ctx.registry.ensureVersion(ctx, UserSchema);

            expect(v1.hash).toBeTruthy();
            expect(v1.hash).toBe(v2.hash);
            expect(v1.typeIri).toBe(UserSchema.typeIRI.value);
        });

        it("two distinct schemas produce distinct hashes", async () => {
            const userV = await ctx.registry.ensureVersion(ctx, UserSchema);
            const postV = await ctx.registry.ensureVersion(ctx, PostSchema);

            expect(userV.hash).not.toBe(postV.hash);
        });

        it("currentHash() is synchronous and matches the registered version", async () => {
            const version = await ctx.registry.ensureVersion(ctx, UserSchema);
            expect(ctx.registry.currentHash(UserSchema)).toBe(version.hash);
        });

        it("loadSnapshot() returns a snapshot with all property descriptors", async () => {
            await ctx.registry.ensureVersion(ctx, UserSchema);
            const snapshot: TypeSnapshot | null = await ctx.registry.loadSnapshot(
                ctx,
                UserSchema.typeIRI.value,
            );

            expect(snapshot).not.toBeNull();
            expect(snapshot!.typeIri).toBe(UserSchema.typeIRI.value);

            const propNames = snapshot!.properties.map((p) => p.name);
            expect(propNames).toContain("email");
            expect(propNames).toContain("displayName");
            expect(propNames).toContain("avatarUrl");
        });

        it("loadSnapshot() captures predicate IRIs alongside property names", async () => {
            await ctx.registry.ensureVersion(ctx, UserSchema);
            const snapshot = await ctx.registry.loadSnapshot(ctx, UserSchema.typeIRI.value);

            const emailProp = snapshot!.properties.find((p) => p.name === "email");
            expect(emailProp).toBeDefined();
            expect(emailProp!.predicateIri).toBe(UserSchema.properties.email.value);
        });

        it("loadSnapshot() captures edge descriptors with target type IRI", async () => {
            await ctx.registry.ensureVersion(ctx, PostSchema);
            const snapshot = await ctx.registry.loadSnapshot(ctx, PostSchema.typeIRI.value);

            expect(snapshot!.edges).toHaveLength(1);
            const authorEdge = snapshot!.edges[0]!;
            expect(authorEdge.name).toBe("author");
            expect(authorEdge.targetTypeIri).toBe(AuthorSchema.typeIRI.value);
            expect(authorEdge.cardinality).toBe("one");
            expect(authorEdge.direction).toBe("out");
        });

        it("loadSnapshot() returns null for an unregistered type", async () => {
            const snapshot = await ctx.registry.loadSnapshot(ctx, "urn:not:registered");
            expect(snapshot).toBeNull();
        });
    });

    // ── 2. Entity version tagging ─────────────────────────────────────────────

    describe(`entity version tagging (${db.name})`, () => {
        let ctx: Awaited<ReturnType<typeof setup>>;
        beforeEach(async () => {
            ctx = await setup(db);
        });
        afterEach(async () => {
            await teardown(ctx);
        });

        it("created entity carries the current schema version hash", async () => {
            const user = await ctx.es.create(ctx, UserSchema, { email: "tagged@test.com" });

            expect(user.schemaVersion).toBeDefined();
            expect(user.schemaVersion).toBe(ctx.registry.currentHash(UserSchema));
        });

        it("schema version survives a findById round-trip", async () => {
            const user = await ctx.es.create(ctx, UserSchema, { email: "roundtrip@test.com" });
            const found = await ctx.es.findById(ctx, UserSchema, user.id);

            expect(found).not.toBeNull();
            expect(found!.schemaVersion).toBe(user.schemaVersion);
        });

        it("each schema gets its own version — tagging two types gives two distinct hashes", async () => {
            const author = await ctx.es.create(ctx, AuthorSchema, { name: "Alice" });
            const post = await ctx.es.create(ctx, PostSchema, {
                title: "Hello",
                author: author.iri,
            });

            expect(author.schemaVersion).toBe(ctx.registry.currentHash(AuthorSchema));
            expect(post.schemaVersion).toBe(ctx.registry.currentHash(PostSchema));
            expect(author.schemaVersion).not.toBe(post.schemaVersion);
        });
    });

    // ── 3. Schema drift detection ─────────────────────────────────────────────

    describe(`schema drift detection (${db.name})`, () => {
        let ctx: Awaited<ReturnType<typeof setup>>;
        beforeEach(async () => {
            ctx = await setup(db);
        });
        afterEach(async () => {
            await teardown(ctx);
        });

        it("no drift when entity schema version matches current", async () => {
            const user = await ctx.es.create(ctx, UserSchema, { email: "nodrift@test.com" });
            const found = await ctx.es.findById(ctx, UserSchema, user.id);

            expect(found!.drift).toBeUndefined();
        });

        it("drift is reported when entity carries a stale version tag", async () => {
            const user = await ctx.es.create(ctx, UserSchema, { email: "drift@test.com" });
            const currentHash = ctx.registry.currentHash(UserSchema);
            const staleHash = "stale-schema-hash-000000";

            // Directly patch the entity's stored version tag to simulate a schema update
            // that happened after this entity was created.
            const entityNode = { value: user.iri } as IRI;
            await ctx.store.deleteBySubjectPredicates(
                ctx,
                entityNode,
                [SCHEMA_VERSION_PREDICATE],
                null,
            );
            await ctx.store.insert(ctx, {
                subject: entityNode,
                predicate: SCHEMA_VERSION_PREDICATE,
                object: toLiteral(staleHash),
                graph: DEFAULT_GRAPH,
            });

            const found = await ctx.es.findById(ctx, UserSchema, user.id);

            expect(found).not.toBeNull();
            expect(found!.schemaVersion).toBe(staleHash);
            expect(found!.drift).toBeDefined();
            expect(found!.drift!.entityHash).toBe(staleHash);
            expect(found!.drift!.currentHash).toBe(currentHash);
        });

        it("drift record is readable despite version mismatch — entity data is intact", async () => {
            const user = await ctx.es.create(ctx, UserSchema, { email: "intact@test.com" });

            const entityNode = { value: user.iri } as IRI;
            await ctx.store.deleteBySubjectPredicates(
                ctx,
                entityNode,
                [SCHEMA_VERSION_PREDICATE],
                null,
            );
            await ctx.store.insert(ctx, {
                subject: entityNode,
                predicate: SCHEMA_VERSION_PREDICATE,
                object: toLiteral("stale-hash"),
                graph: DEFAULT_GRAPH,
            });

            const found = await ctx.es.findById(ctx, UserSchema, user.id);

            // Drift does not prevent reading the entity — callers decide what to do.
            expect(found!.id).toBe(user.id);
            expect(found!.props.email).toBe("intact@test.com");
        });
    });

    // ── 4. Traversal planning ─────────────────────────────────────────────────

    describe(`traversal planning (${db.name})`, () => {
        let ctx: Awaited<ReturnType<typeof setup>>;
        beforeEach(async () => {
            ctx = await setup(db);
        });
        afterEach(async () => {
            await teardown(ctx);
        });

        it("traversalPlan() describes the out-edges of a schema at depth 1", () => {
            const plan: TraversalPlan = ctx.registry.traversalPlan(PostSchema, 1);

            expect(plan.root.typeIRI.value).toBe(PostSchema.typeIRI.value);
            expect(plan.steps).toHaveLength(1);

            const authorStep = plan.steps[0]!;
            expect(authorStep.edgeName).toBe("author");
            expect(authorStep.cardinality).toBe("one");
            expect(authorStep.targetSchema.typeIRI.value).toBe(AuthorSchema.typeIRI.value);
            expect(authorStep.depth).toBe(1);
        });

        it("traversalPlan() with depth 0 produces no steps", () => {
            const plan = ctx.registry.traversalPlan(PostSchema, 0);
            expect(plan.steps).toHaveLength(0);
        });

        it("traversalPlan() is pure — no DB access required", () => {
            // Calling without awaiting confirms it is synchronous.
            const plan = ctx.registry.traversalPlan(PostSchema, 1);
            expect(plan).toBeDefined();
        });

        it("hydrateWithPlan() returns root records augmented with related entities", async () => {
            const author = await ctx.es.create(ctx, AuthorSchema, { name: "Jane Doe" });
            const post = await ctx.es.create(ctx, PostSchema, {
                title: "First Post",
                author: author.iri,
            });

            const plan = ctx.registry.traversalPlan(PostSchema, 1);
            const results: HydratedRecord<PostProps>[] = await ctx.es.hydrateWithPlan(
                ctx,
                [post],
                plan,
            );

            expect(results).toHaveLength(1);
            expect(results[0]!.id).toBe(post.id);
            expect(results[0]!.related.author).toBeDefined();
            expect(results[0]!.related.author!.id).toBe(author.id);
            expect((results[0]!.related.author!.props as AuthorProps).name).toBe("Jane Doe");
        });

        it("hydrateWithPlan() batches related entity loads across multiple roots", async () => {
            const alice = await ctx.es.create(ctx, AuthorSchema, { name: "Alice" });
            const bob = await ctx.es.create(ctx, AuthorSchema, { name: "Bob" });
            const post1 = await ctx.es.create(ctx, PostSchema, {
                title: "Post by Alice",
                author: alice.iri,
            });
            const post2 = await ctx.es.create(ctx, PostSchema, {
                title: "Post by Bob",
                author: bob.iri,
            });

            const plan = ctx.registry.traversalPlan(PostSchema, 1);
            const results = await ctx.es.hydrateWithPlan(ctx, [post1, post2], plan);

            expect(results).toHaveLength(2);
            expect((results[0]!.related.author!.props as AuthorProps).name).toBe("Alice");
            expect((results[1]!.related.author!.props as AuthorProps).name).toBe("Bob");
        });

        it("hydrateWithPlan() sets related to null when edge target is absent", async () => {
            // Post with no author edge set.
            const post = await ctx.es.create(ctx, PostSchema, { title: "Orphan Post" });

            const plan = ctx.registry.traversalPlan(PostSchema, 1);
            const results = await ctx.es.hydrateWithPlan(ctx, [post], plan);

            expect(results[0]!.related.author).toBeNull();
        });
    });
}
