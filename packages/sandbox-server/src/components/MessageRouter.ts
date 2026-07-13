import type { Dispatcher } from "@jasonscharf/app";
import { anonymousSec, errResult, type SecurityContext } from "@jasonscharf/core";
import { FlowComponent, type FlowComponentOptions, type FlowPort } from "@jasonscharf/flow";
import type { IncomingMessage } from "./MessageDecoder.js";
import type { OutgoingMessage } from "./MessageEncoder.js";

export interface MessageRouterOptions extends FlowComponentOptions {
    /**
     * Any object that implements the Dispatcher interface — either a
     * SystemRouter (code-first, Koa-style) or a HandlerRegistry (config-driven).
     */
    dispatcher: Dispatcher;
    /** Extra context fields passed to every handler invocation. */
    handlerContext?: Record<string, unknown>;
    /**
     * Resolves the SecurityContext for a connection id (TRN-527). The host wires
     * this to the WS server's connection map so every dispatched request carries
     * the principal authenticated at upgrade. Defaults to anonymous, so a router
     * with no resolver dispatches as unauthenticated rather than privileged.
     */
    resolveSec?: (connectionId: string) => SecurityContext;
}

/**
 * FBP component that dispatches inbound SystemRequests through a Dispatcher.
 *
 * Accepts both SystemRouter (code-first) and HandlerRegistry (config-driven)
 * since both implement the Dispatcher interface.
 */
export class MessageRouter extends FlowComponent {
    readonly in: FlowPort<IncomingMessage>;
    readonly out: FlowPort<OutgoingMessage>;

    private readonly _dispatcher: Dispatcher;
    private readonly _extraCtx: Record<string, unknown>;
    private readonly _resolveSec: (connectionId: string) => SecurityContext;

    constructor(options: MessageRouterOptions) {
        super(options);
        this._dispatcher = options.dispatcher;
        this._extraCtx = options.handlerContext ?? {};
        this._resolveSec = options.resolveSec ?? (() => anonymousSec);
        this.in = this.addPort<IncomingMessage>("in", "in");
        this.out = this.addPort<OutgoingMessage>("out", "out");
    }

    override step(): void {
        for (;;) {
            const msg = this.in.read();
            if (msg === undefined) {
                break;
            }
            // _dispatch is total: it converts every failure into an error result
            // on the out port, so this promise never rejects. The catch is a
            // defensive backstop that logs rather than letting a stray rejection
            // escape as an unhandled rejection and crash the process (TRN-527).
            this._dispatch(msg).catch((err) => {
                console.error(
                    `[MessageRouter] unexpected dispatch rejection for connection ${msg.connectionId}:`,
                    err,
                );
            });
        }
    }

    private async _dispatch(incoming: IncomingMessage): Promise<void> {
        try {
            // Resolve the connection's principal and thread it (plus a null
            // tenant) into dispatch. The registry normalizes both, so handlers
            // read a guaranteed `ctx.sec` — anonymous unless the connection
            // authenticated.
            const sec = this._resolveSec(incoming.connectionId);
            const result = await this._dispatcher.dispatch(incoming.request, {
                connectionId: incoming.connectionId,
                ...this._extraCtx,
                sec,
                tenantId: null,
            });
            this.out.put({ connectionId: incoming.connectionId, result });
        } catch (err) {
            // A throwing dispatcher or sec resolver must never become an
            // unhandled rejection: send the client an error result instead so
            // the request fails cleanly and the process survives (TRN-527).
            console.error(
                `[MessageRouter] dispatch failed for connection ${incoming.connectionId}:`,
                err,
            );
            this.out.put({
                connectionId: incoming.connectionId,
                result: errResult(
                    incoming.request.id,
                    incoming.request.type,
                    "Internal error dispatching request",
                ),
            });
        }
    }
}
