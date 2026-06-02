/**
 * Graph-scoped multi-tenancy tests.
 *
 * Verifies that EntityStore operations are isolated to the tenant graph when
 * tenantId is present on ServerContext, and fall back to DEFAULT_GRAPH when
 * tenantId is absent.
 */

import { IRI } from "@jasonscharf/core";
import { createDataContext, TripleStore } from "@jasonscharf/data";
import { EntitySchema, handle } from "@jasonscharf/entities";
import { EntityStore, type ServerContext } from "@jasonscharf/server";
import type { Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { up as seedData } from "../../../data/src/migrations/001_init.js";

// ── Widget schema (reused across tests) ──────────────────────────────────────

const NS = "http://tern.dev/test/tenancy/";
const WIDGET_IRI = new IRI(`${NS}Widget`);
const NAME_IRI = new IRI(`${NS}name`);
const CORE_HANDLE = handle("tern:widget.core");

interface WidgetProps {
    name: string;
}

const WidgetSchema = new EntitySchema<WidgetProps>({
    typeIRI: WIDGET_IRI,
    ns: NS,
    coreGroup: {
        handle: CORE_HANDLE,
        properties: { name: NAME_IRI },
    },
});

// ── Test setup ────────────────────────────────────────────────────────────────

describe("EntityStore — tenant isolation", () => {
    let knex: Knex;
    let store: TripleStore;
    let entityStore: EntityStore;
    let trx: Knex.Transaction;

    function ctx(tenantId?: string): ServerContext {
        return tenantId ? { trx, tenantId } : { trx };
    }

    beforeEach(async () => {
        knex = await createDataContext({ client: "sqlite", filename: ":memory:" });
        await seedData(knex);
        trx = await knex.transaction();
        store = new TripleStore(knex);
        entityStore = new EntityStore(store);
    });

    afterEach(async () => {
        await trx.rollback();
        await knex.destroy();
    });

    it("testEntitiesCreatedInTenantGraphAreNotVisibleWithoutTenantId", async () => {
        const record = await entityStore.create(ctx("tenant-a"), WidgetSchema, { name: "Alpha" });
        const found = await entityStore.findById(ctx(), WidgetSchema, record.id, "*");
        expect(found).toBeNull();
    });

    it("testEntitiesCreatedWithoutTenantIdAreNotVisibleToTenants", async () => {
        const record = await entityStore.create(ctx(), WidgetSchema, { name: "Global" });
        const found = await entityStore.findById(ctx("tenant-a"), WidgetSchema, record.id, "*");
        expect(found).toBeNull();
    });

    it("testTenantOnlySeesOwnEntities", async () => {
        const a = await entityStore.create(ctx("tenant-a"), WidgetSchema, { name: "AlphaWidget" });
        const b = await entityStore.create(ctx("tenant-b"), WidgetSchema, { name: "BetaWidget" });

        const foundA = await entityStore.findById(ctx("tenant-a"), WidgetSchema, a.id, "*");
        const foundB = await entityStore.findById(ctx("tenant-b"), WidgetSchema, b.id, "*");
        const crossAB = await entityStore.findById(ctx("tenant-a"), WidgetSchema, b.id, "*");
        const crossBA = await entityStore.findById(ctx("tenant-b"), WidgetSchema, a.id, "*");

        expect(foundA?.id).toBe(a.id);
        expect(foundB?.id).toBe(b.id);
        expect(crossAB).toBeNull();
        expect(crossBA).toBeNull();
    });

    it("testUpdateGroupRemainsWithinTenantGraph", async () => {
        const record = await entityStore.create(ctx("tenant-a"), WidgetSchema, { name: "Before" });

        await entityStore.updateGroup(ctx("tenant-a"), WidgetSchema, record.id, CORE_HANDLE, {
            name: "After",
        });

        const updated = await entityStore.findById(ctx("tenant-a"), WidgetSchema, record.id, "*");
        expect(updated?.groups[CORE_HANDLE.id]?.name).toBe("After");

        // Cross-tenant lookup still returns null
        const crossLookup = await entityStore.findById(
            ctx("tenant-b"),
            WidgetSchema,
            record.id,
            "*",
        );
        expect(crossLookup).toBeNull();
    });

    it("testDeleteOnlyAffectsTenantGraph", async () => {
        const a = await entityStore.create(ctx("tenant-a"), WidgetSchema, { name: "TenantA" });
        const b = await entityStore.create(ctx("tenant-b"), WidgetSchema, { name: "TenantB" });

        await entityStore.delete(ctx("tenant-a"), WidgetSchema, a.id);

        expect(await entityStore.findById(ctx("tenant-a"), WidgetSchema, a.id, "*")).toBeNull();
        // Tenant B's entity is untouched
        expect(await entityStore.findById(ctx("tenant-b"), WidgetSchema, b.id, "*")).not.toBeNull();
    });

    it("testNoTenantContextContinuesToUseDefaultGraph", async () => {
        const record = await entityStore.create(ctx(), WidgetSchema, { name: "Global" });
        const found = await entityStore.findById(ctx(), WidgetSchema, record.id, "*");
        expect(found?.id).toBe(record.id);
    });

    it("testTenantIdWithSpecialCharactersIsEncoded", async () => {
        // tenantId may contain URL-special characters (slashes, spaces, unicode).
        // encodeURIComponent must keep them safe inside the graph IRI.
        const weirdTenantId = "acme corp/division & branch";
        const record = await entityStore.create(ctx(weirdTenantId), WidgetSchema, { name: "Quirky" });

        const found = await entityStore.findById(ctx(weirdTenantId), WidgetSchema, record.id, "*");
        expect(found?.id).toBe(record.id);

        // Other tenants cannot see it
        const notFound = await entityStore.findById(ctx("acme-corp"), WidgetSchema, record.id, "*");
        expect(notFound).toBeNull();
    });

    it("testTenantGraphIriIsStableAcrossInstances", async () => {
        // The same tenantId must always resolve to the same graph IRI.
        // If two ServerContext objects share a tenantId, their writes must
        // be visible to each other.
        const r1 = await entityStore.create(ctx("stable"), WidgetSchema, { name: "First" });
        const r2 = await entityStore.findById(ctx("stable"), WidgetSchema, r1.id, "*");
        expect(r2?.groups[CORE_HANDLE.id]?.name).toBe("First");
    });
});
