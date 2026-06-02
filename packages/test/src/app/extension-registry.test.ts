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
        ctx = { ...defaultServerContext, trx };
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

    it("test is installed returns false for unknown extension", async () => {
        expect(await registry.isInstalled(ctx, "tern.rbac")).toBe(false);
    });

    it("test record and is installed", async () => {
        await registry.record(ctx, "tern.rbac", "1.0.0");
        expect(await registry.isInstalled(ctx, "tern.rbac")).toBe(true);
    });

    it("test get version returns null for unrecorded", async () => {
        expect(await registry.getVersion(ctx, "tern.rbac")).toBeNull();
    });

    it("test get version returns recorded version", async () => {
        await registry.record(ctx, "tern.rbac", "1.2.3");
        expect(await registry.getVersion(ctx, "tern.rbac")).toBe("1.2.3");
    });

    it("test record updates version on re record", async () => {
        await registry.record(ctx, "tern.rbac", "1.0.0");
        await registry.record(ctx, "tern.rbac", "2.0.0");
        expect(await registry.getVersion(ctx, "tern.rbac")).toBe("2.0.0");
    });

    it("test remove unregisters extension", async () => {
        await registry.record(ctx, "tern.rbac", "1.0.0");
        await registry.remove(ctx, "tern.rbac");
        expect(await registry.isInstalled(ctx, "tern.rbac")).toBe(false);
    });

    it("test list returns all installed extensions", async () => {
        await registry.record(ctx, "tern.rbac", "1.0.0");
        await registry.record(ctx, "tern.convos", "0.5.0");
        const list = await registry.list(ctx);
        expect(list).toHaveLength(2);
        const names = list.map((e) => e.name).sort();
        expect(names).toEqual(["tern.convos", "tern.rbac"]);
    });

    it("test list returns empty when nothing installed", async () => {
        expect(await registry.list(ctx)).toHaveLength(0);
    });

    // ── Manager: install ──────────────────────────────────────────────────────

    it("test install calls install hook and records", async () => {
        const calls: string[] = [];
        const ext = makeExt("tern.rbac", "1.0.0", calls);

        await manager.install(ext);

        expect(calls).toEqual(["install:tern.rbac@1.0.0"]);
        expect(await registry.isInstalled(ctx, "tern.rbac")).toBe(true);
    });

    it("test install is idempotent at same version", async () => {
        const calls: string[] = [];
        const ext = makeExt("tern.rbac", "1.0.0", calls);

        await manager.install(ext);
        await manager.install(ext);

        expect(calls).toHaveLength(1);
    });

    it("test install calls upgrade when version changes", async () => {
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

    it("test uninstall calls hook and removes record", async () => {
        const calls: string[] = [];
        const ext = makeExt("tern.rbac", "1.0.0", calls);

        await manager.install(ext);
        await manager.uninstall(ext);

        expect(calls).toContain("uninstall:tern.rbac@1.0.0");
        expect(await registry.isInstalled(ctx, "tern.rbac")).toBe(false);
    });

    it("test uninstall is noop when not installed", async () => {
        const calls: string[] = [];
        const ext = makeExt("tern.rbac", "1.0.0", calls);
        await manager.uninstall(ext); // not installed — no error, no hook call
        expect(calls.filter((c) => c.startsWith("uninstall"))).toHaveLength(0);
    });

    // ── Manager: dependency ordering ─────────────────────────────────────────

    it("test install all installs in dependency order", async () => {
        const calls: string[] = [];
        const convos = makeExt("tern.convos", "1.0.0", calls, [{ name: "tern.rbac" }]);
        const rbac = makeExt("tern.rbac", "1.0.0", calls);

        // Pass in reverse order — manager must sort by deps
        await manager.installAll([convos, rbac]);

        const installOrder = calls.filter((c) => c.startsWith("install"));
        expect(installOrder[0]).toBe("install:tern.rbac@1.0.0");
        expect(installOrder[1]).toBe("install:tern.convos@1.0.0");
    });

    it("test install all throws on missing dependency", async () => {
        const calls: string[] = [];
        const convos = makeExt("tern.convos", "1.0.0", calls, [{ name: "tern.rbac" }]);

        await expect(manager.installAll([convos])).rejects.toThrow(
            /tern.convos.*requires.*tern.rbac/i,
        );
    });

    it("test install all throws on circular dependency", async () => {
        // A → B → A is a cycle; _topoSort must detect it and throw.
        // Bug: original implementation used a single 'visited' set which
        // served as both "in-progress" and "finished", so cycles were
        // silently accepted and returned [B, A] instead of throwing.
        const calls: string[] = [];
        const a = makeExt("ext.a", "1.0.0", calls, [{ name: "ext.b" }]);
        const b = makeExt("ext.b", "1.0.0", calls, [{ name: "ext.a" }]);

        await expect(manager.installAll([a, b])).rejects.toThrow(/circular/i);
    });

    it("test install hook throwing does not record extension", async () => {
        // If install() throws, the extension must NOT be recorded in the
        // registry.  Otherwise the next boot would skip install() entirely
        // (idempotent at same version) and the setup would never succeed.
        const badExt: import("@jasonscharf/app").TernExtension = {
            name: "ext.bad",
            version: "1.0.0",
            async install() { throw new Error("setup failed"); },
        };

        await expect(manager.install(badExt)).rejects.toThrow("setup failed");
        expect(await registry.isInstalled(ctx, "ext.bad")).toBe(false);
    });

    it("test upgrade with no hook still updates version", async () => {
        // An extension may bump its version without needing a migration.
        // If no upgrade() hook is defined, installAll should still record
        // the new version so subsequent boots don't attempt to run install().
        const calls: string[] = [];
        const v1 = makeExt("ext.no-migrate", "1.0.0", calls);
        const v2: import("@jasonscharf/app").TernExtension = {
            name: "ext.no-migrate",
            version: "2.0.0",
            async install() { calls.push("install:v2"); },
            // No upgrade() hook
        };

        await manager.install(v1);
        await manager.install(v2);

        expect(calls).toEqual(["install:ext.no-migrate@1.0.0"]);
        expect(await registry.getVersion(ctx, "ext.no-migrate")).toBe("2.0.0");
    });
});
