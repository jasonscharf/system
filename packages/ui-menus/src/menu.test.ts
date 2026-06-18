import { describe, expect, it } from "vitest";
import { assembleMenu, type MenuItemConfig } from "./menu.js";

const items: MenuItemConfig[] = [
    { id: "home", label: "Home", order: 1, kind: "command", message: "nav.home" },
    { id: "admin", label: "Admin", order: 3, requires: "admin" },
    { id: "admin.users", label: "Users", parent: "admin", kind: "command", message: "nav.users" },
    { id: "reports", label: "Reports", order: 2 },
    { id: "reports.sales", label: "Sales", parent: "reports", order: 2 },
    { id: "reports.kpi", label: "KPI", parent: "reports", order: 1 },
];

describe("assembleMenu", () => {
    it("test assembles ordered tree from flat config", () => {
        const tree = assembleMenu(items, { capabilities: new Set(["admin"]) });
        expect(tree.map((n) => n.item.id)).toEqual(["home", "reports", "admin"]);

        const reports = tree.find((n) => n.item.id === "reports");
        expect(reports?.children.map((c) => c.item.id)).toEqual(["reports.kpi", "reports.sales"]);
    });

    it("test gates items and subtrees by capability", () => {
        // Without the admin capability, admin and its child both disappear.
        const tree = assembleMenu(items);
        expect(tree.map((n) => n.item.id)).toEqual(["home", "reports"]);
        const flatIds = JSON.stringify(tree);
        expect(flatIds).not.toContain("admin.users");
    });

    it("test drops orphans whose parent is missing", () => {
        const orphaned: MenuItemConfig[] = [
            { id: "child", label: "Child", parent: "ghost" },
            { id: "top", label: "Top" },
        ];
        const tree = assembleMenu(orphaned);
        expect(tree.map((n) => n.item.id)).toEqual(["top"]);
    });

    it("test empty config yields empty menu", () => {
        expect(assembleMenu([])).toEqual([]);
    });

    it("test filters items to a named slot", () => {
        const slotted: MenuItemConfig[] = [
            { id: "home", label: "Home", slot: "primary", order: 1 },
            { id: "reports", label: "Reports", slot: "primary", order: 2 },
            { id: "account", label: "Account", slot: "settings", order: 1 },
            { id: "help", label: "Help", slot: "settings", order: 2 },
        ];

        const primary = assembleMenu(slotted, { slot: "primary" });
        expect(primary.map((n) => n.item.id)).toEqual(["home", "reports"]);

        const settings = assembleMenu(slotted, { slot: "settings" });
        expect(settings.map((n) => n.item.id)).toEqual(["account", "help"]);
    });

    it("test unslotted call returns only items with no slot", () => {
        const mixed: MenuItemConfig[] = [
            { id: "a", label: "A" },
            { id: "b", label: "B", slot: "secondary" },
            { id: "c", label: "C", slot: null },
        ];

        const defaults = assembleMenu(mixed);
        expect(defaults.map((n) => n.item.id)).toEqual(["a", "c"]);
    });

    it("test slot items are excluded from default call", () => {
        const mixed: MenuItemConfig[] = [
            { id: "nav-home", label: "Home" },
            { id: "settings-account", label: "Account", slot: "settings" },
        ];
        const tree = assembleMenu(mixed);
        expect(tree.every((n) => n.item.id !== "settings-account")).toBe(true);
    });
});
