import { describe, expect, it } from "vitest";
import { InMemoryDispatch } from "./dispatch.js";
import { bindView, type ViewDefinition } from "./views.js";

interface CounterModel {
    label: string;
    increment(): Promise<void>;
    [key: string]: unknown;
}

describe("view to view-model binding", () => {
    it("test binds view model with params and dispatch", () => {
        const dispatch = new InMemoryDispatch();
        const def: ViewDefinition<CounterModel, { label: string }> = {
            id: "counter",
            params: { label: "Clicks" },
            viewModel: (ctx) => ({
                label: ctx.params.label,
                increment: () => ctx.dispatch.command("counter.inc").exec({ by: 1 }),
            }),
            render: (model) => `${model.label}`,
        };

        const bound = bindView<CounterModel, { label: string }, string>(def, dispatch);
        expect(bound.id).toBe("counter");
        expect(bound.model.label).toBe("Clicks");
        expect(bound.render()).toBe("Clicks");
    });

    it("test view model issues command through dispatch", async () => {
        const dispatch = new InMemoryDispatch();
        let total = 0;
        dispatch.register<{ by: number }>("counter.inc", (arg) => {
            total += arg.by;
        });

        const def: ViewDefinition<CounterModel> = {
            id: "counter",
            viewModel: (ctx) => ({
                label: "x",
                increment: () => ctx.dispatch.command("counter.inc").exec({ by: 2 }),
            }),
            render: (model) => model.label,
        };

        const bound = bindView<CounterModel, Record<string, unknown>, string>(def, dispatch);
        await bound.model.increment();
        await bound.model.increment();
        expect(total).toBe(4);
    });

    it("test defaults params to empty object", () => {
        const dispatch = new InMemoryDispatch();
        const def: ViewDefinition = {
            id: "noparams",
            viewModel: (ctx) => ({ keys: Object.keys(ctx.params) }),
            render: () => "ok",
        };
        const bound = bindView(def, dispatch);
        expect(bound.model.keys).toEqual([]);
    });
});
