// @vitest-environment jsdom
import { Composition, InMemoryDispatch } from "@jasonscharf/core-ui";
import {
    CompositionProvider,
    CompositionRevision,
    RevisionProvider,
} from "@jasonscharf/core-ui/react";
import { act, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { MenuRegistry } from "../registry.js";
import { MenuProvider } from "./context.js";
import { MenuView, type MenuViewProps } from "./MenuView.js";

function Shell(props: {
    composition: Composition;
    revision: CompositionRevision;
    menus: MenuRegistry;
    menuProps?: MenuViewProps;
}): React.ReactElement {
    const { composition, revision, menus, menuProps } = props;
    return (
        <CompositionProvider composition={composition}>
            <RevisionProvider revision={revision}>
                <MenuProvider menus={menus}>
                    <MenuView className="shell-nav" {...menuProps} />
                </MenuProvider>
            </RevisionProvider>
        </CompositionProvider>
    );
}

function click(label: string): void {
    const button = screen.getByText(label);
    act(() => {
        button.click();
    });
}

afterEach(() => {
    document.body.innerHTML = "";
});

describe("MenuView (config-driven menu)", () => {
    it("test renders the assembled tree and defaults the aria-label", () => {
        const composition = new Composition();
        const revision = new CompositionRevision();
        const menus = new MenuRegistry();
        menus.apply({
            menu: [
                { id: "home", label: "Home", order: 1 },
                { id: "reports", label: "Reports", order: 2 },
                { id: "reports.kpi", label: "KPI", parent: "reports" },
            ],
        });

        render(<Shell composition={composition} revision={revision} menus={menus} />);

        expect(screen.getByText("Home")).toBeTruthy();
        // Nested child renders under its parent.
        expect(screen.getByText("KPI")).toBeTruthy();
        // Default label applied.
        expect(screen.getByLabelText("Navigation")).toBeTruthy();
    });

    it("test activates a command (default kind) and an explicit command", () => {
        const dispatch = new InMemoryDispatch();
        const composition = new Composition({ dispatch });
        const revision = new CompositionRevision();
        const seen: string[] = [];
        dispatch.register<{ to: string }>("nav.go", (arg) => {
            seen.push(`go:${arg.to}`);
        });

        const menus = new MenuRegistry();
        menus.apply({
            menu: [
                // No kind → defaults to command.
                { id: "home", label: "Home", message: "nav.go", arg: { to: "home" } },
                // Explicit command kind.
                {
                    id: "reports",
                    label: "Reports",
                    kind: "command",
                    message: "nav.go",
                    arg: { to: "reports" },
                },
            ],
        });

        render(<Shell composition={composition} revision={revision} menus={menus} />);
        click("Home");
        click("Reports");
        expect(seen).toEqual(["go:home", "go:reports"]);
    });

    it("test routes event, query, and operation by kind", () => {
        const dispatch = new InMemoryDispatch();
        const composition = new Composition({ dispatch });
        const revision = new CompositionRevision();
        const log: string[] = [];
        dispatch.on<{ at: string }>("nav.changed", (p) => log.push(`event:${p.at}`));
        dispatch.registerQuery<{ q: string }, void>("search", (arg) => {
            log.push(`query:${arg.q}`);
        });
        dispatch.registerOperation<{ id: string }, void>("save", (arg) => {
            log.push(`op:${arg.id}`);
        });

        const menus = new MenuRegistry();
        menus.apply({
            menu: [
                { id: "e", label: "Emit", kind: "event", message: "nav.changed", arg: { at: "x" } },
                { id: "q", label: "Find", kind: "query", message: "search", arg: { q: "term" } },
                { id: "o", label: "Save", kind: "operation", message: "save", arg: { id: "42" } },
            ],
        });

        render(<Shell composition={composition} revision={revision} menus={menus} />);
        click("Emit");
        click("Find");
        click("Save");
        expect(log).toEqual(["event:x", "query:term", "op:42"]);
    });

    it("test grouping item with no message is a no-op but still calls onActivate", () => {
        const dispatch = new InMemoryDispatch();
        const composition = new Composition({ dispatch });
        const revision = new CompositionRevision();
        const activated: string[] = [];

        const menus = new MenuRegistry();
        menus.apply({ menu: [{ id: "section", label: "Section" }] });

        render(
            <Shell
                composition={composition}
                revision={revision}
                menus={menus}
                menuProps={{ label: "Primary", onActivate: (id) => activated.push(id) }}
            />,
        );
        // Custom label is applied.
        expect(screen.getByLabelText("Primary")).toBeTruthy();
        // Clicking a grouping item dispatches nothing but reports activation.
        expect(() => click("Section")).not.toThrow();
        expect(activated).toEqual(["section"]);
    });

    it("test useMenus throws when rendered outside a MenuProvider", () => {
        const composition = new Composition();
        expect(() =>
            render(
                <CompositionProvider composition={composition}>
                    <MenuView />
                </CompositionProvider>,
            ),
        ).toThrow(/useMenus must be used within a MenuProvider/);
    });
});
