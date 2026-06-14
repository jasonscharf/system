import { describe, expect, it } from "vitest";
import { InMemoryDispatch } from "./dispatch.js";
import { RegionRegistry } from "./regions.js";
import { bindView, type ViewDefinition } from "./views.js";

function makeView(id: string, text: string): ViewDefinition<{ text: string }> {
    return {
        id,
        viewModel: () => ({ text }),
        render: (model) => `[${model.text}]`,
    };
}

describe("RegionRegistry", () => {
    it("test hosts contributed views for region", () => {
        const registry = new RegionRegistry();
        registry.contribute({ region: "sidebar", view: makeView("a", "A") });
        registry.contribute({ region: "sidebar", view: makeView("b", "B") });

        const views = registry.viewsFor("sidebar");
        expect(views.map((v) => v.id)).toEqual(["a", "b"]);
        expect(registry.regions()).toEqual(["sidebar"]);
        expect(registry.hasRegion("sidebar")).toBe(true);
    });

    it("test unknown region yields empty result", () => {
        const registry = new RegionRegistry();
        expect(registry.viewsFor("nope")).toEqual([]);
        expect(registry.hasRegion("nope")).toBe(false);
    });

    it("test orders by explicit order then insertion", () => {
        const registry = new RegionRegistry();
        registry.contribute({ region: "r", view: makeView("late", "L"), order: 10 });
        registry.contribute({ region: "r", view: makeView("early", "E"), order: 1 });
        registry.contribute({ region: "r", view: makeView("mid1", "M1") });
        registry.contribute({ region: "r", view: makeView("mid2", "M2") });

        expect(registry.viewsFor("r").map((v) => v.id)).toEqual(["mid1", "mid2", "early", "late"]);
    });

    it("test conditionally contributed view respects when", () => {
        const registry = new RegionRegistry();
        let visible = false;
        registry.contribute({ region: "r", view: makeView("cond", "C"), when: () => visible });
        registry.contribute({ region: "r", view: makeView("always", "A") });

        expect(registry.viewsFor("r").map((v) => v.id)).toEqual(["always"]);
        visible = true;
        expect(registry.viewsFor("r").map((v) => v.id)).toEqual(["cond", "always"]);
    });

    it("test disposer withdraws contribution and recomposes", () => {
        const registry = new RegionRegistry();
        const dispose = registry.contribute({ region: "r", view: makeView("a", "A") });
        registry.contribute({ region: "r", view: makeView("b", "B") });
        expect(registry.viewsFor("r")).toHaveLength(2);

        dispose();
        expect(registry.viewsFor("r").map((v) => v.id)).toEqual(["b"]);

        // Removing the last contribution drops the region entirely.
        const disposeB = registry.contribute({ region: "solo", view: makeView("x", "X") });
        disposeB();
        expect(registry.hasRegion("solo")).toBe(false);
        // Double dispose is safe.
        disposeB();
    });

    it("test bound view renders through view model", () => {
        const registry = new RegionRegistry();
        registry.contribute({ region: "r", view: makeView("a", "hello") });
        const dispatch = new InMemoryDispatch();
        const [view] = registry.typedViewsFor<{ text: string }>("r");
        const bound = bindView<{ text: string }, Record<string, unknown>, string>(view, dispatch);
        expect(bound.model.text).toBe("hello");
        expect(bound.render()).toBe("[hello]");
    });
});
