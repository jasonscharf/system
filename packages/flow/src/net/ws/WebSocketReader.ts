import { FlowComponent, type FlowComponentOptions } from "../../FlowComponent.js";
import type { FlowPort } from "../../FlowPort.js";
import type { WsMessage } from "./WsMessage.js";

/**
 * Receives messages from the WebSocket layer and emits them as flow datagrams.
 * The parent WebSocketServer pushes into `out` directly from WS event handlers.
 */
export class WebSocketReader extends FlowComponent {
    readonly out: FlowPort<WsMessage>;

    constructor(options: FlowComponentOptions) {
        super(options);
        this.out = this.addPort<WsMessage>("out", "out");
    }

    override step(): void {}
}
