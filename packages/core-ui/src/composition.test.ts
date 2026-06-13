import { describe, expect, it } from "vitest";
import { Composition } from "./composition.js";
import { InMemoryDispatch } from "./dispatch.js";
import type { ViewDefinition } from "./views.js";

function view(id: string, text: string): ViewDefinition<{ text: string }> {
    return {
        id,
        viewModel: () => ({ text }),
        render: (model) => model.text,
    };
}

describe("Composition (config-driven composition root)", () => {
    it("testAppliesContributionsAndBindsRegions", () => {
        const composition = new Composition();
        composition.apply({
            regions: [{ region: "main", view: view("welcome", "hi") }],
            menu: [{ id: "home", label: "Home", command: "nav.home" }],
        });

        const bound = composition.bindRegion<string>("main");
        expect(bound.map((b) => b.render())).toEqual(["hi"]);
        expect(composition.menu().map((n) => n.item.id)).toEqual(["home"]);
    });

    it("testWiresDispatchAndRoundTripsCommand", async () => {
        const dispatch = new InMemoryDispatch();
        const composition = new Composition({ dispatch });
        const calls: string[] = [];

        composition.apply({
            wire: (d) => {
                (d as InMemoryDispatch).register<{ id: string }>("nav.go", (arg) => {
                    calls.push(arg.id);
                });
            },
            menu: [{ id: "go", label: "Go", command: "nav.go", commandArg: { id: "x" } }],
        });

        await composition.dispatch.command<{ id: string }>("nav.go").exec({ id: "x" });
        expect(calls).toEqual(["x"]);
    });

    it("testDisposingContributionRecomposes", () => {
        const composition = new Composition();
        const dispose = composition.apply({
            regions: [{ region: "main", view: view("a", "A") }],
            menu: [{ id: "m", label: "M" }],
        });
        composition.apply({ regions: [{ region: "main", view: view("b", "B") }] });

        expect(composition.bindRegion("main")).toHaveLength(2);
        expect(composition.menu()).toHaveLength(1);

        dispose();
        expect(composition.bindRegion<string>("main").map((b) => b.render())).toEqual(["B"]);
        expect(composition.menu()).toHaveLength(0);
    });

    it("testConditionalViewRecomposesOnStateChange", () => {
        const composition = new Composition();
        let enabled = false;
        composition.apply({
            regions: [{ region: "main", view: view("flagged", "F"), when: () => enabled }],
        });
        expect(composition.bindRegion("main")).toHaveLength(0);
        enabled = true;
        expect(composition.bindRegion<string>("main").map((b) => b.render())).toEqual(["F"]);
    });

    it("testMenuCapabilityGatingFlowsThroughOptions", () => {
        const composition = new Composition({ menu: { capabilities: new Set(["admin"]) } });
        composition.apply({
            menu: [
                { id: "home", label: "Home" },
                { id: "admin", label: "Admin", requires: "admin" },
            ],
        });
        expect(composition.menu().map((n) => n.item.id)).toEqual(["home", "admin"]);
    });
});
