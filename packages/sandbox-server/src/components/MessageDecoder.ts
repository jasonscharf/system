import { FlowComponent, FlowPort, type FlowComponentOptions } from '@jasonscharf/flow';
import { isTernRequest, type TernRequest } from '@jasonscharf/core';
import type { WsMessage } from '@jasonscharf/flow';


export interface IncomingMessage {
    readonly connectionId: string;
    readonly request: TernRequest;
}

/**
 * Decodes raw WsMessages (JSON text) into typed TernRequests.
 * Malformed messages are silently dropped.
 */
export class MessageDecoder extends FlowComponent {
    readonly in: FlowPort<WsMessage>;
    readonly out: FlowPort<IncomingMessage>;

    constructor(options: FlowComponentOptions) {
        super(options);
        this.in  = this.addPort<WsMessage>('in', 'in');
        this.out = this.addPort<IncomingMessage>('out', 'out');
    }

    override step(): void {
        let msg: WsMessage | undefined;
        while ((msg = this.in.read()) !== undefined) {
            try {
                const raw = JSON.parse(typeof msg.data === 'string' ? msg.data : new TextDecoder().decode(msg.data));
                if (isTernRequest(raw)) {
                    this.out.put({ connectionId: msg.connectionId, request: raw });
                }
            } catch {
                // Drop unparseable frames
            }
        }
    }
}
