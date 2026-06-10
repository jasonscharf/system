import { isSystemRequest, type SystemRequest } from "@jasonscharf/core";
import type { WsMessage } from "@jasonscharf/flow";
import { FlowComponent, type FlowComponentOptions, type FlowPort } from "@jasonscharf/flow";

export interface IncomingMessage {
    readonly connectionId: string;
    readonly request: SystemRequest;
}

/**
 * Decodes raw WsMessages (JSON text) into typed SystemRequests.
 * Malformed messages are silently dropped.
 */
export class MessageDecoder extends FlowComponent {
    readonly in: FlowPort<WsMessage>;
    readonly out: FlowPort<IncomingMessage>;

    constructor(options: FlowComponentOptions) {
        super(options);
        this.in = this.addPort<WsMessage>("in", "in");
        this.out = this.addPort<IncomingMessage>("out", "out");
    }

    override step(): void {
        for (;;) {
            const msg = this.in.read();
            if (msg === undefined) {
                break;
            }
            try {
                const raw = JSON.parse(
                    typeof msg.data === "string" ? msg.data : new TextDecoder().decode(msg.data),
                );
                if (isSystemRequest(raw)) {
                    this.out.put({ connectionId: msg.connectionId, request: raw });
                }
            } catch {
                // Drop unparseable frames
            }
        }
    }
}
