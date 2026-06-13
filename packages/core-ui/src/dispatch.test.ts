import { describe, expect, it } from "vitest";
import { InMemoryDispatch } from "./dispatch.js";

describe("InMemoryDispatch (the real seam, not a mock)", () => {
    it("testCommandRoundTrip", async () => {
        const dispatch = new InMemoryDispatch();
        const seen: number[] = [];
        dispatch.register<{ n: number }>("add", (arg) => {
            seen.push(arg.n);
        });

        expect(dispatch.hasCommand("add")).toBe(true);
        await dispatch.command<{ n: number }>("add").exec({ n: 7 });
        expect(seen).toEqual([7]);
    });

    it("testUnknownCommandRejects", async () => {
        const dispatch = new InMemoryDispatch();
        await expect(dispatch.command("missing").exec(null)).rejects.toThrow(
            /No command registered/,
        );
    });

    it("testEventRoundTripToAllListeners", () => {
        const dispatch = new InMemoryDispatch();
        const a: string[] = [];
        const b: string[] = [];
        dispatch.on<string>("ping", (p) => a.push(p));
        const off = dispatch.on<string>("ping", (p) => b.push(p));

        dispatch.event("ping", "one");
        expect(dispatch.listenerCount("ping")).toBe(2);
        expect(a).toEqual(["one"]);
        expect(b).toEqual(["one"]);

        off();
        dispatch.event("ping", "two");
        expect(a).toEqual(["one", "two"]);
        expect(b).toEqual(["one"]);
    });

    it("testEventWithNoListenersIsNoop", () => {
        const dispatch = new InMemoryDispatch();
        expect(() => dispatch.event("silent", 1)).not.toThrow();
        expect(dispatch.listenerCount("silent")).toBe(0);
    });

    it("testReRegisterReplacesImplementation", async () => {
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
