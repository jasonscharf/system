import { FlowComponent, type FlowComponentOptions } from '../../FlowComponent.js';
import { FlowPort } from '../../FlowPort.js';
import type { WsMessage } from './WsMessage.js';


export type WsSendFn = (connectionId: string, data: string | Uint8Array) => void;

/**
 * Reads WsMessages from its input port and dispatches them to the appropriate
 * WebSocket connection via the send function injected by WebSocketServer.
 */
export class WebSocketWriter extends FlowComponent {
    readonly in: FlowPort<WsMessage>;
    private _send?: WsSendFn;

    constructor(options: FlowComponentOptions) {
        super(options);
        this.in = this.addPort<WsMessage>('in', 'in');
    }

    _setSend(fn: WsSendFn): void {
        this._send = fn;
    }

    override step(): void {
        let msg: WsMessage | undefined;
        while ((msg = this.in.read()) !== undefined) {
            this._send?.(msg.connectionId, msg.data);
        }
    }
}
