import { FlowComponent, type FlowComponentOptions } from '../../FlowComponent.js';
import { FlowPort } from '../../FlowPort.js';


export interface WebSocketClientOptions extends FlowComponentOptions {
    url: string;
}

// Minimal interface satisfied by both globalThis.WebSocket (browsers, Node ≥ 22)
// and ws.WebSocket (Node < 22 fallback).  Avoids importing ws types at the top
// level so the module stays environment-agnostic.
interface WsLike {
    binaryType: string;
    send(data: string | Uint8Array): void;
    close(): void;
    addEventListener(type: 'open',    listener: () => void): void;
    addEventListener(type: 'message', listener: (e: { data: unknown }) => void): void;
    addEventListener(type: 'error',   listener: (e: unknown) => void): void;
    addEventListener(type: 'close',   listener: () => void): void;
}

/**
 * A Flow component that wraps a WebSocket client connection.
 *
 * Uses the platform-native WebSocket when available (browsers, Node ≥ 22).
 * Falls back to the bundled `ws` package on older Node environments so this
 * component works on any supported Node version without configuration.
 *
 * Ports:
 *   send        (in)   — data to transmit to the server
 *   received    (out)  — data arriving from the server
 *   connected   (out)  — fires (void) once the connection is open
 *   disconnected(out)  — fires (void) when the connection closes
 */
export class WebSocketClient extends FlowComponent {
    readonly send:         FlowPort<string | Uint8Array>;
    readonly received:     FlowPort<string | Uint8Array>;
    readonly connected:    FlowPort<void>;
    readonly disconnected: FlowPort<void>;

    private readonly _url: string;
    private _ws?: WsLike;

    constructor(options: WebSocketClientOptions) {
        super(options);
        this._url         = options.url;
        this.send         = this.addPort<string | Uint8Array>('send',         'in');
        this.received     = this.addPort<string | Uint8Array>('received',     'out');
        this.connected    = this.addPort<void>('connected',    'out');
        this.disconnected = this.addPort<void>('disconnected', 'out');
    }

    protected override async onInit(): Promise<void> {
        // Prefer the platform-native WebSocket; fall back to the bundled `ws`
        // package so this component works on Node.js < 22 and in test environments.
        const WsCtor: new (url: string) => WsLike =
            typeof globalThis.WebSocket !== 'undefined'
                ? (globalThis.WebSocket as unknown as new (url: string) => WsLike)
                : await import('ws').then(m => m.WebSocket as unknown as new (url: string) => WsLike);

        const ws = new WsCtor(this._url);
        // Request ArrayBuffer binary frames for consistent cross-environment handling.
        ws.binaryType = 'arraybuffer';
        this._ws = ws;

        await new Promise<void>((resolve, reject) => {
            ws.addEventListener('open', () => {
                this.connected.put(undefined as unknown as void);
                resolve();
            });
            ws.addEventListener('error', (e) => reject(e));
        });

        ws.addEventListener('message', (evt) => {
            const raw = evt.data;
            const data: string | Uint8Array =
                raw instanceof ArrayBuffer ? new Uint8Array(raw) : String(raw);
            this.received.put(data);
        });

        ws.addEventListener('close', () => {
            this.disconnected.put(undefined as unknown as void);
        });

        this.addDisposable({ dispose: () => { this._ws?.close(); } });
    }

    override step(): void {
        let data: string | Uint8Array | undefined;
        while ((data = this.send.read()) !== undefined) {
            this._ws?.send(data);
        }
    }
}
