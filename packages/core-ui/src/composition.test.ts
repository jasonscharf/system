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
    it("test applies contributions and binds regions", () => {
        const composition = new Composition();
        composition.apply({
            regions: [{ region: "main", view: view("welcome", "hi") }],
        });

        const bound = composition.bindRegion<string>("main");
        expect(bound.map((b) => b.render())).toEqual(["hi"]);
    });

    it("test wires dispatch and round trips command", async () => {
        const dispatch = new InMemoryDispatch();
        const composition = new Composition({ dispatch });
        const calls: string[] = [];

        composition.apply({
            wire: (d) => {
                (d as InMemoryDispatch).register<{ id: string }>("nav.go", (arg) => {
                    calls.push(arg.id);
                });
            },
        });

        await composition.dispatch.command("nav.go").exec({ id: "x" });
        expect(calls).toEqual(["x"]);
    });

    it("test disposing contribution recomposes", () => {
        const composition = new Composition();
        const dispose = composition.apply({
            regions: [{ region: "main", view: view("a", "A") }],
        });
        composition.apply({ regions: [{ region: "main", view: view("b", "B") }] });

        expect(composition.bindRegion("main")).toHaveLength(2);

        dispose();
        expect(composition.bindRegion<string>("main").map((b) => b.render())).toEqual(["B"]);
    });

    it("test conditional view recomposes on state change", () => {
        const composition = new Composition();
        let enabled = false;
        composition.apply({
            regions: [{ region: "main", view: view("flagged", "F"), when: () => enabled }],
        });
        expect(composition.bindRegion("main")).toHaveLength(0);
        enabled = true;
        expect(composition.bindRegion<string>("main").map((b) => b.render())).toEqual(["F"]);
    });
});
