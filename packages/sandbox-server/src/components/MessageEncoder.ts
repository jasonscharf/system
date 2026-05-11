import { FlowComponent, FlowPort, type FlowComponentOptions } from '@system/flow';
import type { TernResult } from '@system/core';
import type { WsMessage } from '@system/flow';


export interface OutgoingMessage {
    readonly connectionId: string;
    readonly result: TernResult;
}

/**
 * Serialises TernResults to JSON WsMessages ready for WebSocketServer.send.
 */
export class MessageEncoder extends FlowComponent {
    readonly in: FlowPort<OutgoingMessage>;
    readonly out: FlowPort<WsMessage>;

    constructor(options: FlowComponentOptions) {
        super(options);
        this.in  = this.addPort<OutgoingMessage>('in', 'in');
        this.out = this.addPort<WsMessage>('out', 'out');
    }

    override step(): void {
        let msg: OutgoingMessage | undefined;
        while ((msg = this.in.read()) !== undefined) {
            this.out.put({
                connectionId: msg.connectionId,
                data: JSON.stringify(msg.result),
            });
        }
    }
}
