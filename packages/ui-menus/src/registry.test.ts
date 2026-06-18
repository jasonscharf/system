import { describe, expect, it } from "vitest";
import type { MenuItemConfig } from "./menu.js";
import { MenuRegistry } from "./registry.js";

describe("MenuRegistry", () => {
    it("test applies a contribution and assembles the default menu", () => {
        const registry = new MenuRegistry();
        registry.apply({
            menu: [
                { id: "home", label: "Home", order: 1, kind: "command", message: "nav.home" },
                { id: "reports", label: "Reports", order: 2 },
            ],
        });

        expect(registry.assemble().map((n) => n.item.id)).toEqual(["home", "reports"]);
    });

    it("test gates items by capability from constructor options", () => {
        const registry = new MenuRegistry({ menu: { capabilities: new Set(["admin"]) } });
        registry.apply({
            menu: [
                { id: "home", label: "Home" },
                { id: "admin", label: "Admin", requires: "admin" },
            ],
        });
        expect(registry.assemble().map((n) => n.item.id)).toEqual(["home", "admin"]);

        const locked = new MenuRegistry();
        locked.apply({
            menu: [
                { id: "home", label: "Home" },
                { id: "admin", label: "Admin", requires: "admin" },
            ],
        });
        expect(locked.assemble().map((n) => n.item.id)).toEqual(["home"]);
    });

    it("test named slots separate items into distinct menus", () => {
        const registry = new MenuRegistry();
        registry.apply({
            menu: [
                { id: "home", label: "Home", slot: "primary" },
                { id: "reports", label: "Reports", slot: "primary" },
                { id: "account", label: "Account", slot: "settings" },
                { id: "help", label: "Help", slot: "settings" },
            ],
        });

        expect(registry.assemble("primary").map((n) => n.item.id)).toEqual(["home", "reports"]);
        expect(registry.assemble("settings").map((n) => n.item.id)).toEqual(["account", "help"]);
        expect(registry.assemble()).toEqual([]);
    });

    it("test unknown slot yields an empty tree", () => {
        const registry = new MenuRegistry();
        registry.apply({ menu: [{ id: "home", label: "Home", slot: "primary" }] });
        expect(registry.assemble("ghost")).toEqual([]);
    });

    it("test disposing a contribution recomposes the menu", () => {
        const registry = new MenuRegistry();
        const first: MenuItemConfig[] = [{ id: "a", label: "A", order: 1 }];
        const dispose = registry.contribute(first);
        registry.contribute([{ id: "b", label: "B", order: 2 }]);

        expect(registry.assemble().map((n) => n.item.id)).toEqual(["a", "b"]);

        dispose();
        expect(registry.assemble().map((n) => n.item.id)).toEqual(["b"]);

        // Disposing again is a no-op: the items are already gone.
        expect(() => dispose()).not.toThrow();
        expect(registry.assemble().map((n) => n.item.id)).toEqual(["b"]);
    });

    it("test apply with no menu items is a no-op disposer", () => {
        const registry = new MenuRegistry();
        const dispose = registry.apply({});
        expect(registry.assemble()).toEqual([]);
        expect(() => dispose()).not.toThrow();
    });
});
