import { createDataContext, type Knex, TripleStore } from "@jasonscharf/data";
import {
    buildServerContext,
    EntityStore,
    OrgSchema,
    type ServerContext,
    systemSec,
    TenantSchema,
} from "@jasonscharf/server";
import { UserSchema } from "@jasonscharf/auth";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertEmptyStore } from "../assertEmptyStore.js";

interface DbProvider {
    name: string;
    create: () => Promise<Knex>;
}

const providers: DbProvider[] = [
    { name: "SQLite (in-memory)", create: () => createDataContext({ client: "sqlite", filename: ":memory:" }) },
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

/** Builds a tenant→org→user tree in the given tenant's graph and returns the ids. */
async function seedTree(
    es: EntityStore,
    ctx: ServerContext,
    tenantId: string,
    emails: string[],
): Promise<{ orgId: string; userIris: string[] }> {
    await es.create(ctx, TenantSchema, { name: `tenant-${tenantId}` }, tenantId);
    const org = await es.create(ctx, OrgSchema, { name: `org-${tenantId}` });
    await es.addEdge(ctx, TenantSchema, tenantId, "org", org);

    const userIris: string[] = [];
    for (const email of emails) {
        const user = await es.create(ctx, UserSchema, { email });
        await es.addEdge(ctx, OrgSchema, org.id, "member", user.iri);
        userIris.push(user.iri);
    }
    return { orgId: org.id, userIris };
}

for (const provider of providers) {
    describe(`GraphQuery rooted traversal — ${provider.name}`, () => {
        let knex: Knex;
        let trx: Knex.Transaction;
        let store: TripleStore;
        let es: EntityStore;

        beforeEach(async () => {
            knex = await provider.create();
            trx = await knex.transaction();
            store = new TripleStore(knex);
            es = new EntityStore(store);
        });
        afterEach(async () => {
            await trx.rollback();
            await assertEmptyStore(knex);
            await knex.destroy();
        });

        const ctxFor = (tenantId: string): ServerContext =>
            buildServerContext(store, { trx, tenantId });

        it("walks tenant→org→member to the users", async () => {
            const ctx = ctxFor("t1");
            await seedTree(es, ctx, "t1", ["a@x.com", "b@x.com"]);

            const users = await ctx.graph(systemSec).out("org").out("member").all(UserSchema);
            expect(users.map((u) => u.props.email).sort()).toEqual(["a@x.com", "b@x.com"]);
        });

        it("filters the leaf with .where", async () => {
            const ctx = ctxFor("t1");
            await seedTree(es, ctx, "t1", ["a@x.com", "b@x.com"]);

            const found = await ctx
                .graph(systemSec)
                .out("org")
                .out("member")
                .where("email", "=", "a@x.com")
                .all(UserSchema);
            expect(found.map((u) => u.props.email)).toEqual(["a@x.com"]);

            const none = await ctx
                .graph(systemSec)
                .out("org")
                .out("member")
                .where("email", "=", "nobody@x.com")
                .all(UserSchema);
            expect(none).toHaveLength(0);
        });

        it("isolates tenants: a user in tenant B is unreachable from tenant A", async () => {
            await seedTree(es, ctxFor("t1"), "t1", ["alice@x.com"]);
            await seedTree(es, ctxFor("t2"), "t2", ["bob@x.com"]);

            const fromA = await ctxFor("t1").graph(systemSec).out("org").out("member").all(UserSchema);
            expect(fromA.map((u) => u.props.email)).toEqual(["alice@x.com"]);

            const fromB = await ctxFor("t2").graph(systemSec).out("org").out("member").all(UserSchema);
            expect(fromB.map((u) => u.props.email)).toEqual(["bob@x.com"]);
        });

        it("reachability rigor: a user not attached under the tenant tree is invisible", async () => {
            const ctx = ctxFor("t1");
            await seedTree(es, ctx, "t1", ["attached@x.com"]);
            // An orphan user in the same tenant graph, never linked via hasMember.
            await es.create(ctx, UserSchema, { email: "orphan@x.com" });

            const users = await ctx.graph(systemSec).out("org").out("member").all(UserSchema);
            expect(users.map((u) => u.props.email)).toEqual(["attached@x.com"]);
        });

        it("returns nothing when ctx has no tenant root", async () => {
            const ctx = ctxFor("t1");
            await seedTree(es, ctx, "t1", ["a@x.com"]);

            const rootless = buildServerContext(store, { trx }); // no tenantId
            const users = await rootless.graph(systemSec).out("org").out("member").all(UserSchema);
            expect(users).toHaveLength(0);
        });
    });
}
