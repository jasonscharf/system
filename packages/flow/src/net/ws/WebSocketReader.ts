import { FlowComponent, type FlowComponentOptions } from '../../FlowComponent.js';
import { FlowPort } from '../../FlowPort.js';
import type { WsMessage } from './WsMessage.js';


/**
 * Receives messages from the WebSocket layer and emits them as flow datagrams.
 * The parent WebSocketServer calls _inject() from WebSocket event handlers;
 * this component never needs to be stepped directly.
 */
export class WebSocketReader extends FlowComponent {
    readonly out: FlowPort<WsMessage>;

    constructor(options: FlowComponentOptions) {
        super(options);
        this.out = this.addPort<WsMessage>('out', 'out');
    }

    _inject(msg: WsMessage): void {
        this.out.put(msg);
    }

    override step(): void {
        // Driven entirely by _inject() from the WebSocket event loop.
    }
}
