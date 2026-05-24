import { FlowComponent, type FlowComponentOptions } from "../../FlowComponent.js";
import type { FlowPort } from "../../FlowPort.js";

export interface WebSocketClientOptions extends FlowComponentOptions {
    url: string;
}

/**
 * A Flow component that wraps a WebSocket client connection using the
 * platform-native WebSocket API (globalThis.WebSocket — Node.js ≥ 22,
 * all modern browsers). No third-party dependencies.
 *
 * Ports:
 *   send        (in)   — data to transmit to the server
 *   received    (out)  — data arriving from the server
 *   connected   (out)  — fires (void) once the connection is open
 *   disconnected(out)  — fires (void) when the connection closes
 */
export class WebSocketClient extends FlowComponent {
    readonly send: FlowPort<string | Uint8Array>;
    readonly received: FlowPort<string | Uint8Array>;
    readonly connected: FlowPort<void>;
    readonly disconnected: FlowPort<void>;

    private readonly _url: string;
    private _ws?: WebSocket;

    constructor(options: WebSocketClientOptions) {
        super(options);
        this._url = options.url;
        this.send = this.addPort<string | Uint8Array>("send", "in");
        this.received = this.addPort<string | Uint8Array>("received", "out");
        this.connected = this.addPort<void>("connected", "out");
        this.disconnected = this.addPort<void>("disconnected", "out");
    }

    protected override async onInit(): Promise<void> {
        if (typeof globalThis.WebSocket === "undefined") {
            throw new Error(
                "WebSocketClient requires a platform-native WebSocket (Node.js ≥ 22, " +
                    "modern browsers). No globalThis.WebSocket found.",
            );
        }

        const ws = new globalThis.WebSocket(this._url);
        // Request binary frames as ArrayBuffer so the handler branch is consistent
        // across browsers and Node.js (default in Node.js 22+ is 'blob').
        ws.binaryType = "arraybuffer";
        this._ws = ws;

        await new Promise<void>((resolve, reject) => {
            ws.addEventListener("open", () => {
                this.connected.put(undefined as unknown as undefined);
                resolve();
            });
            ws.addEventListener("error", (e) => reject(e));
        });

        ws.addEventListener("message", (evt) => {
            const raw = evt.data;
            const data: string | Uint8Array =
                raw instanceof ArrayBuffer ? new Uint8Array(raw) : String(raw);
            this.received.put(data);
        });

        ws.addEventListener("close", () => {
            this.disconnected.put(undefined as unknown as undefined);
        });

        this.addDisposable({
            dispose: () => {
                this._ws?.close();
            },
        });
    }

    override step(): void {
        for (;;) {
            const data = this.send.read();
            if (data === undefined) {
                break;
            }
            this._ws?.send(data);
        }
    }
}
