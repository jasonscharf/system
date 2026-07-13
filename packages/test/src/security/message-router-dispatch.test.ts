/**
 * TRN-527 (added scope, moved from TRN-528) — MessageRouter dispatch safety.
 *
 * The router previously fired `void this._dispatch(msg)`: a throwing handler or
 * sec resolver became a detached, unhandled promise rejection that could crash
 * the process and leave the client hanging with no reply. This proves the router
 * is now total — every failure yields an error SystemResult on the out port, and
 * no unhandled rejection escapes.
 *
 * Real components only: a real HandlerRegistry with a real (throwing) inline
 * handler, and a real MessageRouter. No mocks/spies.
 */

import { HandlerRegistry } from "@jasonscharf/app";
import { errResult, query, SYSTEM_TYPES, type SystemResult } from "@jasonscharf/core";
import { FlowApp } from "@jasonscharf/flow";
import { afterEach, describe, expect, it } from "vitest";
import type { OutgoingMessage } from "../../../sandbox-server/src/components/MessageEncoder.js";
import { MessageRouter } from "../../../sandbox-server/src/components/MessageRouter.js";

async function drainOut(router: MessageRouter): Promise<OutgoingMessage> {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
        const msg = router.out.read();
        if (msg !== undefined) {
            return msg;
        }
        await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error("router.out produced no message");
}

describe("TRN-527 — MessageRouter dispatches without detached promises", () => {
    let app: FlowApp;
    let unhandled: unknown[];
    const onUnhandled = (err: unknown) => {
        unhandled.push(err);
    };

    afterEach(async () => {
        process.off("unhandledRejection", onUnhandled);
        if (app !== undefined) {
            await app.stop();
        }
    });

    function startWith(router: MessageRouter): void {
        app.addComponent(router);
    }

    it("emits an error result (not an unhandled rejection) when a handler throws", async () => {
        unhandled = [];
        process.on("unhandledRejection", onUnhandled);
        app = new FlowApp({ mode: "push" });

        // A real registry with a real handler that throws. HandlerRegistry
        // itself catches the throw and returns an error result, so the client is
        // always answered — proving "throwing handler → client receives error
        // result, process survives".
        const registry = new HandlerRegistry();
        registry.registerInline(SYSTEM_TYPES.ping, async () => {
            throw new Error("handler boom");
        });
        const router = new MessageRouter({
            name: "router",
            context: app.context,
            dispatcher: registry,
        });
        startWith(router);
        await app.start();
        app.scheduler.start();

        router.in.put({ connectionId: "c1", request: query(SYSTEM_TYPES.ping) });
        const out = await drainOut(router);
        expect(out.connectionId).toBe("c1");
        expect(out.result.ok).toBe(false);

        await new Promise((r) => setTimeout(r, 50));
        expect(unhandled).toHaveLength(0);
    });

    it("emits an error result when the dispatcher itself rejects", async () => {
        unhandled = [];
        process.on("unhandledRejection", onUnhandled);
        app = new FlowApp({ mode: "push" });

        // A real Dispatcher whose dispatch rejects outright (not caught by any
        // registry). This is the case the old `void` swallowed. The router must
        // convert it into an error result on the out port.
        const rejectingDispatcher = {
            dispatch: (): Promise<SystemResult> => Promise.reject(new Error("dispatch boom")),
        };
        const router = new MessageRouter({
            name: "router",
            context: app.context,
            dispatcher: rejectingDispatcher,
        });
        startWith(router);
        await app.start();
        app.scheduler.start();

        const req = query(SYSTEM_TYPES.ping);
        router.in.put({ connectionId: "c2", request: req });
        const out = await drainOut(router);
        expect(out.connectionId).toBe("c2");
        expect(out.result.ok).toBe(false);
        // The router answers the client with an error correlated to the request.
        expect(out.result.correlationId).toBe(req.id);
        expect(out.result.type.iri).toBe(req.type.iri);
        expect(out.result.error).toBe("Internal error dispatching request");

        await new Promise((r) => setTimeout(r, 50));
        expect(unhandled).toHaveLength(0);
    });

    it("emits an error result when the sec resolver throws", async () => {
        unhandled = [];
        process.on("unhandledRejection", onUnhandled);
        app = new FlowApp({ mode: "push" });

        const registry = new HandlerRegistry();
        registry.registerInline(SYSTEM_TYPES.ping, async (request) =>
            errResult(request.id, request.type, "unreachable"),
        );
        const router = new MessageRouter({
            name: "router",
            context: app.context,
            dispatcher: registry,
            resolveSec: () => {
                throw new Error("resolver boom");
            },
        });
        startWith(router);
        await app.start();
        app.scheduler.start();

        router.in.put({ connectionId: "c3", request: query(SYSTEM_TYPES.ping) });
        const out = await drainOut(router);
        expect(out.result.ok).toBe(false);

        await new Promise((r) => setTimeout(r, 50));
        expect(unhandled).toHaveLength(0);
    });
});
