// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import type React from "react";
import { Text, View } from "react-native";
import { afterEach, describe, expect, it } from "vitest";
import { Composition } from "../composition.js";
import type { ViewDefinition } from "../views.js";
import { CompositionProvider, CompositionRevision, RevisionProvider } from "./context.js";
import { RegionHost } from "./RegionHost.js";

function reactView(id: string, label: string): ViewDefinition<{ label: string }> {
    return {
        id,
        viewModel: () => ({ label }),
        render: (model): React.ReactNode => <Text className="probe">{model.label}</Text>,
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
                <View className="shell">
                    <RegionHost name="main" className="shell__main" fallback={<Text>empty</Text>} />
                </View>
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
                <RegionHost name="ghost" fallback={<Text>nothing here</Text>} />
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
});
