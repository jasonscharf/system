import { FlowComponent, type FlowComponentOptions } from '../../FlowComponent.js';
import { FlowPort } from '../../FlowPort.js';


export interface WebSocketClientOptions extends FlowComponentOptions {
    url: string;
}

/**
 * A Flow component that wraps a WebSocket client connection.
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
        this.send = this.addPort<string | Uint8Array>('send', 'in');
        this.received = this.addPort<string | Uint8Array>('received', 'out');
        this.connected = this.addPort<void>('connected', 'out');
        this.disconnected = this.addPort<void>('disconnected', 'out');
    }

    protected override async onInit(): Promise<void> {
        // Use the native global WebSocket when available (browsers, Node ≥ 22),
        // otherwise fall back to the ws package (Node < 22 / test env).
        const WsClass: typeof WebSocket =
            typeof globalThis.WebSocket !== 'undefined'
                ? globalThis.WebSocket
                : (await import('ws')).WebSocket as unknown as typeof WebSocket;

        const ws = new WsClass(this._url);
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
                raw instanceof ArrayBuffer
                    ? new Uint8Array(raw)
                    : raw instanceof Uint8Array
                        ? raw
                        : String(raw);
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
