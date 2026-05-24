import { FlowComponent, type FlowComponentOptions } from "../../FlowComponent.js";
import type { FlowPort } from "../../FlowPort.js";
import type { WsMessage } from "./WsMessage.js";

export interface WebSocketWriterOptions extends FlowComponentOptions {
    send: (connectionId: string, data: string | Uint8Array) => void;
}

/**
 * Reads WsMessages from its input port and dispatches them to the appropriate
 * WebSocket connection via the send function provided at construction.
 */
export class WebSocketWriter extends FlowComponent {
    readonly in: FlowPort<WsMessage>;
    private readonly _send: (connectionId: string, data: string | Uint8Array) => void;

    constructor(options: WebSocketWriterOptions) {
        super(options);
        this._send = options.send;
        this.in = this.addPort<WsMessage>("in", "in");
    }

    override step(): void {
        for (;;) {
            const msg = this.in.read();
            if (msg === undefined) {
                break;
            }
            this._send(msg.connectionId, msg.data);
        }
    }
}
