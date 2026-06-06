/**
 * Audit trail integration tests.
 *
 * Runs against SQLite (always) and Postgres (when TERN_PG_URL is set), each in
 * a rolled-back transaction for clean isolation.
 */

import { createDataContext, TripleStore } from "@jasonscharf/data";
import {
    AuditRepository,
    buildServerContext,
    type ServerContext,
    systemSec,
} from "@jasonscharf/server";
import type { Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

interface DbProvider {
    name: string;
    create(): Promise<Knex>;
}

const providers: DbProvider[] = [
    {
        name: "SQLite (in-memory)",
        create: () => createDataContext({ client: "sqlite", filename: ":memory:" }),
    },
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

const REAL = "urn:sys:core:auth:user:real";
const TARGET = "urn:sys:core:auth:user:target";

for (const provider of providers) {
    describe(`AuditRepository — ${provider.name}`, () => {
        let knex: Knex;
        let trx: Knex.Transaction;
        let ctx: ServerContext;
        let store: TripleStore;
        let repo: AuditRepository;

        beforeEach(async () => {
            knex = await provider.create();
            trx = await knex.transaction();
            store = new TripleStore(knex);
            ctx = buildServerContext(store, { trx });
            repo = new AuditRepository(store);
        });
        afterEach(async () => {
            await trx.rollback();
            await knex.destroy();
        });

        it("records an action with actor, actingAs, and target", async () => {
            const entry = await repo.record(ctx, systemSec, {
                action: "impersonation.start",
                actor: REAL,
                actingAs: TARGET,
                target: TARGET,
            });
            expect(entry.id).toBeTruthy();
            expect(entry.iri).toContain("urn:sys:core:audit:event:");
            expect(entry.at).toBeInstanceOf(Date);

            const all = await repo.list(ctx, systemSec);
            expect(all).toHaveLength(1);
            expect(all[0].action).toBe("impersonation.start");
            expect(all[0].actor).toBe(REAL);
            expect(all[0].actingAs).toBe(TARGET);
            expect(all[0].target).toBe(TARGET);
        });

        it("omits actingAs/target when not supplied", async () => {
            await repo.record(ctx, systemSec, { action: "user.login", actor: REAL });
            const all = await repo.list(ctx, systemSec);
            expect(all[0].actor).toBe(REAL);
            expect(all[0].actingAs).toBeUndefined();
            expect(all[0].target).toBeUndefined();
        });

        it("returns entries most-recent first and honours limit", async () => {
            await repo.record(ctx, systemSec, { action: "a.1", actor: REAL });
            await new Promise((r) => setTimeout(r, 5));
            await repo.record(ctx, systemSec, { action: "a.2", actor: REAL });
            await new Promise((r) => setTimeout(r, 5));
            await repo.record(ctx, systemSec, { action: "a.3", actor: REAL });

            const all = await repo.list(ctx, systemSec);
            expect(all.map((e) => e.action)).toEqual(["a.3", "a.2", "a.1"]);

            const limited = await repo.list(ctx, systemSec, { limit: 2 });
            expect(limited.map((e) => e.action)).toEqual(["a.3", "a.2"]);
        });

        it("returns an empty trail when nothing has been recorded", async () => {
            expect(await repo.list(ctx, systemSec)).toEqual([]);
        });
    });
}
