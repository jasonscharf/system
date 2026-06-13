// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Composition } from "../composition.js";
import type { ViewDefinition } from "../views.js";
import { CompositionProvider, CompositionRevision, RevisionProvider } from "./context.js";
import { MenuView } from "./MenuView.js";
import { RegionHost } from "./RegionHost.js";

function reactView(id: string, label: string): ViewDefinition<{ label: string }> {
    return {
        id,
        viewModel: () => ({ label }),
        render: (model): React.ReactNode => <span className="probe">{model.label}</span>,
    };
}

function Shell(props: {
    composition: Composition;
    revision: CompositionRevision;
}): React.ReactElement {
    const { composition, revision } = props;
    return (
        <CompositionProvider composition={composition}>
            <RevisionProvider revision={revision}>
                <div className="shell">
                    <MenuView className="shell__nav" />
                    <RegionHost name="main" className="shell__main" fallback={<em>empty</em>} />
                </div>
            </RevisionProvider>
        </CompositionProvider>
    );
}

afterEach(() => {
    document.body.innerHTML = "";
});

describe("React composition shell", () => {
    it("testRegionHostsContributedViewAndEmptyFallback", () => {
        const composition = new Composition();
        const revision = new CompositionRevision();
        composition.apply({ regions: [{ region: "main", view: reactView("hello", "Hello") }] });

        render(<Shell composition={composition} revision={revision} />);
        expect(screen.getByText("Hello")).toBeTruthy();

        // A region with nothing contributed shows its fallback.
        const empty = new Composition();
        render(
            <CompositionProvider composition={empty}>
                <RegionHost name="ghost" fallback={<em>nothing here</em>} />
            </CompositionProvider>,
        );
        expect(screen.getByText("nothing here")).toBeTruthy();
    });

    it("testConfigChangeRecomposesViaRevisionBump", () => {
        const composition = new Composition();
        const revision = new CompositionRevision();
        render(<Shell composition={composition} revision={revision} />);
        expect(screen.queryByText("Late")).toBeNull();

        act(() => {
            composition.apply({ regions: [{ region: "main", view: reactView("late", "Late") }] });
            revision.bump();
        });
        expect(screen.getByText("Late")).toBeTruthy();
    });

    it("testMenuRendersConfigAndDispatchesCommandOnActivate", () => {
        const composition = new Composition();
        const revision = new CompositionRevision();
        const activated: string[] = [];
        composition.apply({
            wire: (d) => {
                // The InMemoryDispatch is the real seam.
                (d as import("../dispatch.js").InMemoryDispatch).register("nav.home", () => {
                    activated.push("nav.home");
                });
            },
            menu: [{ id: "home", label: "Home", command: "nav.home" }],
        });

        render(<Shell composition={composition} revision={revision} />);
        const button = screen.getByText("Home");
        act(() => {
            button.click();
        });
        expect(activated).toEqual(["nav.home"]);
    });
});
