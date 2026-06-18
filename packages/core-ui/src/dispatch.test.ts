import { describe, expect, it } from "vitest";
import { InMemoryDispatch, type RequestSig } from "./dispatch.js";

// Augment the ambient registries for the message names this suite uses. This is
// exactly how an extension declares its messages; here it also lets the typed
// arg/result flow through `command`/`query`/`operation`/`on`/`event` below.
declare module "./dispatch.js" {
    interface SystemCommands {
        add: { n: number };
    }
    interface SystemEvents {
        ping: string;
    }
    interface SystemQueries {
        sum: RequestSig<{ a: number; b: number }, number>;
    }
    interface SystemOperations {
        save: RequestSig<{ id: string }, { ok: boolean }>;
    }
}

describe("InMemoryDispatch (the real seam, not a mock)", () => {
    it("test command round trip with typed arg", async () => {
        const dispatch = new InMemoryDispatch();
        const seen: number[] = [];
        dispatch.register<{ n: number }>("add", (arg) => {
            seen.push(arg.n);
        });

        expect(dispatch.hasCommand("add")).toBe(true);
        // `arg` is typed `{ n: number }` here purely from the ambient SystemCommands entry.
        await dispatch.command("add").exec({ n: 7 });
        expect(seen).toEqual([7]);
    });

    it("test unknown command rejects", async () => {
        const dispatch = new InMemoryDispatch();
        await expect(dispatch.command("missing").exec(null)).rejects.toThrow(
            /No command registered/,
        );
    });

    it("test query round trip resolves a result", async () => {
        const dispatch = new InMemoryDispatch();
        dispatch.registerQuery<{ a: number; b: number }, number>("sum", (arg) => arg.a + arg.b);

        const total = await dispatch.query("sum").exec({ a: 2, b: 3 });
        expect(total).toBe(5);
    });

    it("test unknown query rejects", async () => {
        const dispatch = new InMemoryDispatch();
        await expect(dispatch.query("sum").exec({ a: 1, b: 1 })).rejects.toThrow(
            /No query registered/,
        );
    });

    it("test operation round trip resolves a result", async () => {
        const dispatch = new InMemoryDispatch();
        dispatch.registerOperation<{ id: string }, { ok: boolean }>("save", async (arg) => ({
            ok: arg.id.length > 0,
        }));

        const result = await dispatch.operation("save").exec({ id: "x" });
        expect(result).toEqual({ ok: true });
    });

    it("test unknown operation rejects", async () => {
        const dispatch = new InMemoryDispatch();
        await expect(dispatch.operation("save").exec({ id: "x" })).rejects.toThrow(
            /No operation registered/,
        );
    });

    it("test event round trip to all listeners", () => {
        const dispatch = new InMemoryDispatch();
        const a: string[] = [];
        const b: string[] = [];
        dispatch.on("ping", (p) => a.push(p));
        const off = dispatch.on("ping", (p) => b.push(p));

        dispatch.event("ping", "one");
        expect(dispatch.listenerCount("ping")).toBe(2);
        expect(a).toEqual(["one"]);
        expect(b).toEqual(["one"]);

        off();
        dispatch.event("ping", "two");
        expect(a).toEqual(["one", "two"]);
        expect(b).toEqual(["one"]);
    });

    it("test event with no listeners is noop", () => {
        const dispatch = new InMemoryDispatch();
        expect(() => dispatch.event("silent", 1)).not.toThrow();
        expect(dispatch.listenerCount("silent")).toBe(0);
    });

    it("test re register replaces implementation", async () => {
        const dispatch = new InMemoryDispatch();
        let value = "first";
        dispatch.register("set", () => {
            value = "first-impl";
        });
        dispatch.register("set", () => {
            value = "second-impl";
        });
        await dispatch.command("set").exec(null);
        expect(value).toBe("second-impl");
    });
});
