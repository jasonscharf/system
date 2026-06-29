/**
 * Dispatch manifest tests — the runtime-discovery contract (TRN-454).
 *
 * `DefRegistry.describe()` and `DispatchHost.describe()` project every
 * registered dispatch def into a flat, JSON-serializable manifest a generic
 * client (the future Tern CLI, WebSockets, Switchyard) consumes to discover the
 * dispatch surface and auto-build its command tree.  This slice is pure
 * in-memory logic, so no infra is needed; it follows the package's vitest
 * patterns and uses real registry/host objects (no mocks).
 */

import { InMemorySystemBus } from "@jasonscharf/core";
import { DefRegistry, DispatchHost, type DispatchManifestEntry } from "@jasonscharf/events";
import { describe, expect, it } from "vitest";

// JSON-Schema args/result objects, exactly as an authoring layer would supply.
const VIEW_ACTIVATE_ARGS = {
    type: "object",
    properties: { viewId: { type: "string" } },
    required: ["viewId"],
};
const VIEW_LIST_ARGS = {
    type: "object",
    properties: { id: { type: "number" } },
    required: ["id"],
};
const VIEW_LIST_RESULT = {
    type: "object",
    properties: { count: { type: "number" } },
};
const VIEW_BUMP_ARGS = {
    type: "object",
    properties: { key: { type: "string" }, by: { type: "number" } },
};
const VIEW_BUMP_RESULT = {
    type: "object",
    properties: { key: { type: "string" }, value: { type: "number" } },
};

function buildRegistry(): DefRegistry {
    const registry = new DefRegistry();
    // Fully documented across all four kinds (intentionally out of sorted order
    // so the deterministic ordering is actually exercised).
    registry.registerOperation("view.bump", {
        invocations: ["module://noop"],
        reducers: [],
        description: "Increment a counter and return its new value.",
        argSchema: VIEW_BUMP_ARGS,
        resultSchema: VIEW_BUMP_RESULT,
    });
    registry.registerQuery("view.list", {
        invocations: ["module://noop"],
        reducers: [],
        description: "List views.",
        argSchema: VIEW_LIST_ARGS,
        resultSchema: VIEW_LIST_RESULT,
    });
    registry.registerEvent("view.activated", {
        invocations: ["module://noop"],
        description: "A view became active.",
        argSchema: VIEW_ACTIVATE_ARGS,
    });
    registry.registerCommand("view.activate", {
        invocations: ["module://noop"],
        description: "Activate a view.",
        argSchema: VIEW_ACTIVATE_ARGS,
    });
    // No metadata at all — proves the optional fields are simply absent.
    registry.registerCommand("view.bare", {
        invocations: ["module://noop"],
    });
    return registry;
}

describe("dispatch manifest — DefRegistry.describe()", () => {
    it("returns the full catalog, deterministically ordered by kind then name", () => {
        const manifest = buildRegistry().describe();

        const order = manifest.map((e) => `${e.kind}::${e.name}`);
        expect(order).toEqual([
            "command::view.activate",
            "command::view.bare",
            "event::view.activated",
            "query::view.list",
            "operation::view.bump",
        ]);
    });

    it("projects each documented def to its correct manifest shape", () => {
        const manifest = buildRegistry().describe();
        const byKey = new Map(manifest.map((e) => [`${e.kind}::${e.name}`, e]));

        expect(byKey.get("command::view.activate")).toEqual({
            kind: "command",
            name: "view.activate",
            description: "Activate a view.",
            argSchema: VIEW_ACTIVATE_ARGS,
        });
        expect(byKey.get("event::view.activated")).toEqual({
            kind: "event",
            name: "view.activated",
            description: "A view became active.",
            argSchema: VIEW_ACTIVATE_ARGS,
        });
        expect(byKey.get("query::view.list")).toEqual({
            kind: "query",
            name: "view.list",
            description: "List views.",
            argSchema: VIEW_LIST_ARGS,
            resultSchema: VIEW_LIST_RESULT,
        });
        expect(byKey.get("operation::view.bump")).toEqual({
            kind: "operation",
            name: "view.bump",
            description: "Increment a counter and return its new value.",
            argSchema: VIEW_BUMP_ARGS,
            resultSchema: VIEW_BUMP_RESULT,
        });
    });

    it("describes defs without metadata, with the optional fields absent", () => {
        const manifest = buildRegistry().describe();
        const bare = manifest.find((e) => e.name === "view.bare");

        expect(bare).toEqual({ kind: "command", name: "view.bare" });
        expect(bare).not.toHaveProperty("description");
        expect(bare).not.toHaveProperty("argSchema");
        expect(bare).not.toHaveProperty("resultSchema");
    });

    it("omits resultSchema for command/event kinds", () => {
        const manifest = buildRegistry().describe();
        for (const entry of manifest) {
            if (entry.kind === "command" || entry.kind === "event") {
                expect(entry).not.toHaveProperty("resultSchema");
            }
        }
    });

    it("is JSON round-trippable (the manifest may cross a queue)", () => {
        const manifest = buildRegistry().describe();
        const roundTripped = JSON.parse(JSON.stringify(manifest)) as DispatchManifestEntry[];
        expect(roundTripped).toEqual(manifest);
    });

    it("returns an empty catalog for an empty registry", () => {
        expect(new DefRegistry().describe()).toEqual([]);
    });
});

describe("dispatch manifest — DispatchHost.describe()", () => {
    it("delegates to the registry and returns the same catalog", () => {
        const registry = buildRegistry();
        const bus = new InMemorySystemBus();
        const host = new DispatchHost(bus, registry);

        expect(host.describe()).toEqual(registry.describe());
    });
});
