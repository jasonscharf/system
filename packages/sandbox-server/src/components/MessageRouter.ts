import type { Dispatcher } from "@jasonscharf/app";
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

    constructor(options: MessageRouterOptions) {
        super(options);
        this._dispatcher = options.dispatcher;
        this._extraCtx = options.handlerContext ?? {};
        this.in = this.addPort<IncomingMessage>("in", "in");
        this.out = this.addPort<OutgoingMessage>("out", "out");
    }

    override step(): void {
        for (;;) {
            const msg = this.in.read();
            if (msg === undefined) {
                break;
            }
            void this._dispatch(msg);
        }
    }

    private async _dispatch(incoming: IncomingMessage): Promise<void> {
        const result = await this._dispatcher.dispatch(incoming.request, {
            connectionId: incoming.connectionId,
            ...this._extraCtx,
        });
        this.out.put({ connectionId: incoming.connectionId, result });
    }
}
