/**
 * Tests for resolveModuleRef — the canonical `module://` URI resolver.
 *
 * Uses real fixture modules (no mocks).  Fixtures live at
 * packages/test/src/core/fixtures/modref/.
 *
 * Each test imports fixtures via `file://` URIs so the paths are
 * deterministic regardless of where vitest is invoked from.
 */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { _clearModuleRefCache, resolveModuleRef } from "@jasonscharf/core";
import { afterEach, describe, expect, it } from "vitest";

// ── Fixture paths ─────────────────────────────────────────────────────────────

const FIXTURE_DIR = resolve(new URL(import.meta.url).pathname, "../fixtures/modref");

function fixtureUrl(filename: string): string {
    return pathToFileURL(resolve(FIXTURE_DIR, filename)).href;
}

// ── Cache reset ───────────────────────────────────────────────────────────────

afterEach(() => {
    _clearModuleRefCache();
});

// ── Named export ──────────────────────────────────────────────────────────────

describe("resolveModuleRef: named export", () => {
    it("resolves a named export function and calls it", async () => {
        const uri = `module://${fixtureUrl("named-exports.ts")}#greet`;
        const { fn, args } = await resolveModuleRef(uri);
        expect(typeof fn).toBe("function");
        expect(args).toEqual({});
        expect(fn("World")).toBe("Hello, World!");
    });

    it("parses query args alongside named export", async () => {
        const fileUri = fixtureUrl("named-exports.ts");
        const uri = `module://${fileUri}#greet?greeting=Hi&locale=en`;
        const { fn, args } = await resolveModuleRef(uri);
        expect(fn("Alice")).toBe("Hello, Alice!");
        expect(args).toEqual({ greeting: "Hi", locale: "en" });
    });

    it("throws when named export exists but is not a function", async () => {
        const uri = `module://${fixtureUrl("named-exports.ts")}#answerToEverything`;
        await expect(resolveModuleRef(uri)).rejects.toThrow(/not a function/);
    });
});

// ── Default-export method ─────────────────────────────────────────────────────

describe("resolveModuleRef: default-export method", () => {
    it("falls back to method on default export when no named export matches", async () => {
        const uri = `module://${fixtureUrl("named-exports.ts")}#sweep`;
        const { fn, args } = await resolveModuleRef(uri);
        expect(typeof fn).toBe("function");
        expect(args).toEqual({});
        expect(fn("active")).toBe("sweeping scope=active");
    });

    it("binds the method to the default export object", async () => {
        // `compute` on the default export uses no `this`, but binding must not break it
        const uri = `module://${fixtureUrl("named-exports.ts")}#compute`;
        const { fn } = await resolveModuleRef(uri);
        expect(fn()).toBe(100);
    });

    it("resolves a callable default export (no fragment)", async () => {
        const uri = `module://${fixtureUrl("callable-default.ts")}`;
        const { fn } = await resolveModuleRef(uri);
        expect(fn("Bob")).toBe("hi Bob");
    });
});

// ── Query args ────────────────────────────────────────────────────────────────

describe("resolveModuleRef: query-string args", () => {
    it("returns all query params as string values", async () => {
        const fileUri = fixtureUrl("named-exports.ts");
        const uri = `module://${fileUri}#greet?scope=active&dryRun=false&limit=10`;
        const { args } = await resolveModuleRef(uri);
        expect(args).toEqual({ scope: "active", dryRun: "false", limit: "10" });
    });

    it("returns empty args when no query string", async () => {
        const uri = `module://${fixtureUrl("named-exports.ts")}#greet`;
        const { args } = await resolveModuleRef(uri);
        expect(args).toEqual({});
    });

    it("returns empty args when no fragment and no query", async () => {
        const uri = `module://${fixtureUrl("callable-default.ts")}`;
        const { args } = await resolveModuleRef(uri);
        expect(args).toEqual({});
    });
});

// ── Caching ───────────────────────────────────────────────────────────────────

describe("resolveModuleRef: caching", () => {
    it("returns the same ResolvedRef on repeated calls (reference equality)", async () => {
        const uri = `module://${fixtureUrl("named-exports.ts")}#greet`;
        const first = await resolveModuleRef(uri);
        const second = await resolveModuleRef(uri);
        expect(first).toBe(second);
    });
});

// ── Specifier types ───────────────────────────────────────────────────────────

describe("resolveModuleRef: specifier varieties", () => {
    it("resolves a file:// specifier directly", async () => {
        const fileUri = fixtureUrl("named-exports.ts");
        const uri = `module://${fileUri}#greet`;
        const { fn } = await resolveModuleRef(uri);
        expect(fn("file-user")).toBe("Hello, file-user!");
    });

    it("resolves an npm package specifier (named export from @jasonscharf/core)", async () => {
        // uuidv4Binary is a real named export from @jasonscharf/core.
        const uri = "module://@jasonscharf/core#uuidv4Binary";
        const { fn } = await resolveModuleRef(uri);
        expect(typeof fn).toBe("function");
        const bytes = fn() as Uint8Array;
        // uuidv4Binary returns a 16-byte Uint8Array
        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(bytes.length).toBe(16);
    });

    it("resolves a relative specifier against the supplied baseDir", async () => {
        const uri = "module://./named-exports.ts#greet";
        const { fn } = await resolveModuleRef(uri, FIXTURE_DIR);
        expect(fn("relative")).toBe("Hello, relative!");
    });
});

// ── Error paths ───────────────────────────────────────────────────────────────

describe("resolveModuleRef: error paths", () => {
    it("throws on a URI that does not start with module://", async () => {
        await expect(resolveModuleRef("https://example.com/foo")).rejects.toThrow(
            /must start with "module:\/\/"/,
        );
    });

    it("throws on a URI with no specifier after module://", async () => {
        await expect(resolveModuleRef("module://")).rejects.toThrow(/no module specifier/);
    });

    it("throws on a URI with an empty specifier (e.g. module://#member)", async () => {
        await expect(resolveModuleRef("module://#greet")).rejects.toThrow(/empty module specifier/);
    });

    it("throws when the module cannot be found", async () => {
        const uri = "module://file:///nonexistent/does-not-exist.js#greet";
        await expect(resolveModuleRef(uri)).rejects.toThrow();
    });

    it("throws a helpful error when the named member is missing entirely", async () => {
        const uri = `module://${fixtureUrl("named-exports.ts")}#__noSuchExport__`;
        await expect(resolveModuleRef(uri)).rejects.toThrow(
            /__noSuchExport__.*not found|no named export.*__noSuchExport__|no named export or default-export method "__noSuchExport__"/,
        );
    });

    it("throws when no-fragment module has a non-callable default export", async () => {
        const uri = `module://${fixtureUrl("named-exports.ts")}`;
        // named-exports.ts default export is an object, not a function
        await expect(resolveModuleRef(uri)).rejects.toThrow(/no callable default export/);
    });
});
