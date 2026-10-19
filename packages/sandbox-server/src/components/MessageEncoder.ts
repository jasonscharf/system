import type { SystemResult } from "@terncosoftware/core";
import type { WsMessage } from "@terncosoftware/flow";
import { FlowComponent, type FlowComponentOptions, type FlowPort } from "@terncosoftware/flow";

export interface OutgoingMessage {
    readonly connectionId: string;
    readonly result: SystemResult;
}

/**
 * Serialises SystemResults to JSON WsMessages ready for WebSocketServer.send.
 */
export class MessageEncoder extends FlowComponent {
    readonly in: FlowPort<OutgoingMessage>;
    readonly out: FlowPort<WsMessage>;

    constructor(options: FlowComponentOptions) {
        super(options);
        this.in = this.addPort<OutgoingMessage>("in", "in");
        this.out = this.addPort<WsMessage>("out", "out");
    }

    override step(): void {
        for (;;) {
            const msg = this.in.read();
            if (msg === undefined) {
                break;
            }
            this.out.put({
                connectionId: msg.connectionId,
                data: JSON.stringify(msg.result),
            });
        }
    }
}
