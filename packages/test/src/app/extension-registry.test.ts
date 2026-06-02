/**
 * Extension lifecycle + registry integration tests.
 *
 * Uses a real SQLite in-memory store.  No mocks.
 */

import type { TernExtension, TernExtensionContext } from "@jasonscharf/app";
import { createDataContext, TripleStore } from "@jasonscharf/data";
import { ExtensionManager, ExtensionRegistry } from "@jasonscharf/server";
import { defaultServerContext, type ServerContext } from "@jasonscharf/server";
import type { Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { up as seedData } from "../../../data/src/migrations/001_init.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeExt(
    name: string,
    version: string,
    calls: string[],
    requires?: TernExtension["requires"],
): TernExtension {
    return {
        name,
        version,
        requires,
        async install() { calls.push(`install:${name}@${version}`); },
        async uninstall() { calls.push(`uninstall:${name}@${version}`); },
        async upgrade(from, to) { calls.push(`upgrade:${name}:${from}->${to}`); },
    };
}

// ── Test setup ────────────────────────────────────────────────────────────────

describe("ExtensionRegistry + ExtensionManager", () => {
    let knex: Knex;
    let store: TripleStore;
    let trx: Knex.Transaction;
    let ctx: ServerContext;
    let registry: ExtensionRegistry;
    let manager: ExtensionManager;
    let extCtx: TernExtensionContext;

    beforeEach(async () => {
        knex = await createDataContext({ client: "sqlite", filename: ":memory:" });
        await seedData(knex);
        trx = await knex.transaction();
        ctx = { trx };
        store = new TripleStore(knex);
        registry = new ExtensionRegistry(store);
        extCtx = {};
        manager = new ExtensionManager(registry, ctx, extCtx);
    });

    afterEach(async () => {
        await trx.rollback();
        await knex.destroy();
    });

    // ── Registry ──────────────────────────────────────────────────────────────

    it("testIsInstalledReturnsFalseForUnknownExtension", async () => {
        expect(await registry.isInstalled(ctx, "tern.rbac")).toBe(false);
    });

    it("testRecordAndIsInstalled", async () => {
        await registry.record(ctx, "tern.rbac", "1.0.0");
        expect(await registry.isInstalled(ctx, "tern.rbac")).toBe(true);
    });

    it("testGetVersionReturnsNullForUnrecorded", async () => {
        expect(await registry.getVersion(ctx, "tern.rbac")).toBeNull();
    });

    it("testGetVersionReturnsRecordedVersion", async () => {
        await registry.record(ctx, "tern.rbac", "1.2.3");
        expect(await registry.getVersion(ctx, "tern.rbac")).toBe("1.2.3");
    });

    it("testRecordUpdatesVersionOnReRecord", async () => {
        await registry.record(ctx, "tern.rbac", "1.0.0");
        await registry.record(ctx, "tern.rbac", "2.0.0");
        expect(await registry.getVersion(ctx, "tern.rbac")).toBe("2.0.0");
    });

    it("testRemoveUnregistersExtension", async () => {
        await registry.record(ctx, "tern.rbac", "1.0.0");
        await registry.remove(ctx, "tern.rbac");
        expect(await registry.isInstalled(ctx, "tern.rbac")).toBe(false);
    });

    it("testListReturnsAllInstalledExtensions", async () => {
        await registry.record(ctx, "tern.rbac", "1.0.0");
        await registry.record(ctx, "tern.convos", "0.5.0");
        const list = await registry.list(ctx);
        expect(list).toHaveLength(2);
        const names = list.map((e) => e.name).sort();
        expect(names).toEqual(["tern.convos", "tern.rbac"]);
    });

    it("testListReturnsEmptyWhenNothingInstalled", async () => {
        expect(await registry.list(ctx)).toHaveLength(0);
    });

    // ── Manager: install ──────────────────────────────────────────────────────

    it("testInstallCallsInstallHookAndRecords", async () => {
        const calls: string[] = [];
        const ext = makeExt("tern.rbac", "1.0.0", calls);

        await manager.install(ext);

        expect(calls).toEqual(["install:tern.rbac@1.0.0"]);
        expect(await registry.isInstalled(ctx, "tern.rbac")).toBe(true);
    });

    it("testInstallIsIdempotentAtSameVersion", async () => {
        const calls: string[] = [];
        const ext = makeExt("tern.rbac", "1.0.0", calls);

        await manager.install(ext);
        await manager.install(ext);

        expect(calls).toHaveLength(1);
    });

    it("testInstallCallsUpgradeWhenVersionChanges", async () => {
        const calls: string[] = [];
        await manager.install(makeExt("tern.rbac", "1.0.0", calls));
        await manager.install(makeExt("tern.rbac", "2.0.0", calls));

        expect(calls).toEqual([
            "install:tern.rbac@1.0.0",
            "upgrade:tern.rbac:1.0.0->2.0.0",
        ]);
        expect(await registry.getVersion(ctx, "tern.rbac")).toBe("2.0.0");
    });

    // ── Manager: uninstall ────────────────────────────────────────────────────

    it("testUninstallCallsHookAndRemovesRecord", async () => {
        const calls: string[] = [];
        const ext = makeExt("tern.rbac", "1.0.0", calls);

        await manager.install(ext);
        await manager.uninstall(ext);

        expect(calls).toContain("uninstall:tern.rbac@1.0.0");
        expect(await registry.isInstalled(ctx, "tern.rbac")).toBe(false);
    });

    it("testUninstallIsNoopWhenNotInstalled", async () => {
        const calls: string[] = [];
        const ext = makeExt("tern.rbac", "1.0.0", calls);
        await manager.uninstall(ext); // not installed — no error, no hook call
        expect(calls.filter((c) => c.startsWith("uninstall"))).toHaveLength(0);
    });

    // ── Manager: dependency ordering ─────────────────────────────────────────

    it("testInstallAllInstallsInDependencyOrder", async () => {
        const calls: string[] = [];
        const convos = makeExt("tern.convos", "1.0.0", calls, [{ name: "tern.rbac" }]);
        const rbac = makeExt("tern.rbac", "1.0.0", calls);

        // Pass in reverse order — manager must sort by deps
        await manager.installAll([convos, rbac]);

        const installOrder = calls.filter((c) => c.startsWith("install"));
        expect(installOrder[0]).toBe("install:tern.rbac@1.0.0");
        expect(installOrder[1]).toBe("install:tern.convos@1.0.0");
    });

    it("testInstallAllThrowsOnMissingDependency", async () => {
        const calls: string[] = [];
        const convos = makeExt("tern.convos", "1.0.0", calls, [{ name: "tern.rbac" }]);

        await expect(manager.installAll([convos])).rejects.toThrow(
            /tern.convos.*requires.*tern.rbac/i,
        );
    });
});
