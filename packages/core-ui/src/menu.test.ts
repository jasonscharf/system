import { describe, expect, it } from "vitest";
import { assembleMenu, type MenuItemConfig } from "./menu.js";

const items: MenuItemConfig[] = [
    { id: "home", label: "Home", order: 1, command: "nav.home" },
    { id: "admin", label: "Admin", order: 3, requires: "admin" },
    { id: "admin.users", label: "Users", parent: "admin", command: "nav.users" },
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
});
