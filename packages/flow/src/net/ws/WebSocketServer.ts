import { uuidv4Binary } from "@jasonscharf/core";
import type { WebSocket as WsSocket } from "ws";
import { FlowComponent, type FlowComponentOptions } from "../../FlowComponent.js";
import type { FlowPort } from "../../FlowPort.js";
import { LocalTransport } from "../../FlowTransport.js";
import { WebSocketReader } from "./WebSocketReader.js";
import { WebSocketWriter } from "./WebSocketWriter.js";
import type { WsMessage } from "./WsMessage.js";

export interface WebSocketServerOptions extends FlowComponentOptions {
    host?: string;
    port: number;
}

function hexId(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

/**
 * A composite Flow component that hosts a WebSocket server.
 *
 * Internal architecture:
 *   ┌─────────────────────────────────────────────┐
 *   │  WebSocketServer                            │
 *   │                                             │
 *   │  ws events ──► WebSocketReader.out ─────► received (out)
 *   │                                             │
 *   │  send (in) ──► step() ──► WebSocketWriter.in ──► ws.send()
 *   └─────────────────────────────────────────────┘
 *
 * Ports (external):
 *   received    (out)  — WsMessage arriving from any connected client
 *   send        (in)   — WsMessage to dispatch to a specific client
 *   connected   (out)  — connectionId of each newly accepted client
 *   disconnected(out)  — connectionId of each closed client
 */
export class WebSocketServer extends FlowComponent {
    readonly received: FlowPort<WsMessage>;
    readonly send: FlowPort<WsMessage>;
    readonly connected: FlowPort<string>;
    readonly disconnected: FlowPort<string>;

    readonly reader: WebSocketReader;
    readonly writer: WebSocketWriter;

    private readonly _host?: string;
    private readonly _port: number;
    private readonly _connections = new Map<string, WsSocket>();

    constructor(options: WebSocketServerOptions) {
        super(options);
        this._host = options.host;
        this._port = options.port;

        this.received = this.addPort<WsMessage>("received", "out");
        this.send = this.addPort<WsMessage>("send", "in");
        this.connected = this.addPort<string>("connected", "out");
        this.disconnected = this.addPort<string>("disconnected", "out");

        this.reader = new WebSocketReader({ name: `${this.name}.reader`, context: this.context });
        this.writer = new WebSocketWriter({
            name: `${this.name}.writer`,
            context: this.context,
            send: (id, data) => {
                this._connections.get(id)?.send(data);
            },
        });
        this.addChild(this.reader);
        this.addChild(this.writer);

        // Internal routing: reader.out → this.received
        this.reader.out._addTransport(new LocalTransport(this.reader.out, this.received));
    }

    protected override async onInit(): Promise<void> {
        // Lazy-load ws so this module doesn't hard-require Node.js at import time.
        const { WebSocketServer: WsServer } = await import("ws");

        const wss = new WsServer({ host: this._host ?? "127.0.0.1", port: this._port });
        this._wss = wss;

        wss.on("connection", (ws) => {
            const id = hexId(uuidv4Binary());
            this._connections.set(id, ws);
            this.connected.put(id);

            ws.on("message", (raw) => {
                const data = (raw as Buffer).toString("utf8");
                this.reader.out.put({ connectionId: id, data });
            });

            ws.on("close", () => {
                this._connections.delete(id);
                this.disconnected.put(id);
            });
        });

        this.addDisposable({
            dispose: () =>
                new Promise<void>((resolve) => {
                    for (const client of wss.clients) {
                        client.terminate();
                    }
                    wss.close(() => resolve());
                }),
        });

        await new Promise<void>((resolve, reject) => {
            wss.once("listening", resolve);
            wss.once("error", reject);
        });
    }

    override step(): void {
        // Bridge: server.send → writer.in so the writer can dispatch to clients.
        for (;;) {
            const msg = this.send.read();
            if (msg === undefined) {
                break;
            }
            this.writer.in.put(msg);
        }
    }
}
