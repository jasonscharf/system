import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { uuidv4Binary } from "@jasonscharf/core";
import type { WebSocketServer as WsServerType, WebSocket as WsSocket } from "ws";
import { FlowComponent, type FlowComponentOptions } from "../../FlowComponent.js";
import type { FlowPort } from "../../FlowPort.js";
import { wire } from "../../FlowTransport.js";
import { WebSocketReader } from "./WebSocketReader.js";
import { WebSocketWriter } from "./WebSocketWriter.js";
import type { WsConnection, WsPrincipal } from "./WsConnection.js";
import type { WsMessage } from "./WsMessage.js";

export interface WebSocketServerOptions extends FlowComponentOptions {
    host?: string;
    port: number;
    /**
     * Optional upgrade-time authentication. Invoked once per connection attempt
     * with the raw upgrade request (cookies, Authorization header, and Origin
     * are all available on req.headers). Return a principal to accept the
     * connection, or null to reject it with HTTP 401.
     *
     * The flow package supplies no implementation: the host wires a real one (in
     * production, auth's validateToken). When omitted, every origin-allowed
     * connection is accepted with a null principal (open server).
     */
    authenticate?: (req: IncomingMessage) => Promise<WsPrincipal | null>;
    /**
     * Allow-list of acceptable Origin header values (CSWSH defense). When
     * provided, an upgrade whose Origin is not in this list is rejected with
     * HTTP 403; a missing Origin is also rejected. When omitted, the Origin
     * header is not checked (open server) — set this in any browser-facing
     * deployment.
     */
    allowedOrigins?: readonly string[];
}

function hexId(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

function headerValue(value: string | string[] | undefined): string | null {
    if (value === undefined) {
        return null;
    }
    if (Array.isArray(value)) {
        return value[0] ?? null;
    }
    return value;
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
    socket.write(
        `HTTP/1.1 ${status} ${reason}\r\n` +
            "connection: close\r\n" +
            "content-length: 0\r\n" +
            "\r\n",
    );
    socket.destroy();
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
 *
 * Upgrade-time security:
 *   - allowedOrigins rejects cross-site upgrades (CSWSH) with 403.
 *   - authenticate resolves a principal or rejects the upgrade with 401.
 *   - The resolved principal and connection metadata are stamped onto the
 *     connection map; a component reading `received` can call getConnection()
 *     to resolve connectionId -> principal/SecurityContext.
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
    private readonly _authenticate?: (req: IncomingMessage) => Promise<WsPrincipal | null>;
    private readonly _allowedOrigins: readonly string[] | null;
    private readonly _sockets = new Map<string, WsSocket>();
    private readonly _connections = new Map<string, WsConnection>();

    constructor(options: WebSocketServerOptions) {
        super(options);
        this._host = options.host;
        this._port = options.port;
        this._authenticate = options.authenticate;
        this._allowedOrigins = options.allowedOrigins ?? null;

        this.received = this.addPort<WsMessage>("received", "out");
        this.send = this.addPort<WsMessage>("send", "in");
        this.connected = this.addPort<string>("connected", "out");
        this.disconnected = this.addPort<string>("disconnected", "out");

        this.reader = new WebSocketReader({ name: `${this.name}.reader`, context: this.context });
        this.writer = new WebSocketWriter({
            name: `${this.name}.writer`,
            context: this.context,
            send: (id, data) => {
                this._sockets.get(id)?.send(data);
            },
        });
        this.addChild(this.reader);
        this.addChild(this.writer);

        // Internal routing: reader.out → this.received
        wire(this.reader.out, this.received);
    }

    /**
     * Resolve a connectionId (as carried on WsMessage.connectionId) to the
     * connection metadata captured at upgrade, including the authenticated
     * principal. Returns null for unknown or closed connections.
     *
     * Components reading the `received` port use this to recover the principal
     * / SecurityContext for the connection that produced a message.
     */
    getConnection(connectionId: string): WsConnection | null {
        return this._connections.get(connectionId) ?? null;
    }

    /** Convenience: the principal for a connection, or null when unknown. */
    getPrincipal(connectionId: string): WsPrincipal | null {
        return this._connections.get(connectionId)?.principal ?? null;
    }

    private _originAllowed(origin: string | null): boolean {
        if (this._allowedOrigins === null) {
            return true;
        }
        if (origin === null) {
            return false;
        }
        return this._allowedOrigins.includes(origin);
    }

    protected override async onInit(): Promise<void> {
        // Lazy-load ws so this module doesn't hard-require Node.js at import time.
        const { WebSocketServer: WsServer } = await import("ws");
        const { createServer } = await import("node:http");

        // A bare HTTP server owns the listening socket; we handle upgrades
        // ourselves so we can reject with a real HTTP status before the
        // WebSocket handshake completes.
        const httpServer = createServer((_req, res) => {
            res.writeHead(426, { "content-type": "text/plain" });
            res.end("Upgrade Required");
        });
        const wss = new WsServer({ noServer: true });

        httpServer.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
            void this._handleUpgrade(wss, req, socket, head);
        });

        wss.on("connection", (ws: WsSocket, _req: IncomingMessage, connection: WsConnection) => {
            const id = connection.connectionId;
            this._sockets.set(id, ws);
            this._connections.set(id, connection);
            this.connected.put(id);

            ws.on("message", (raw) => {
                const data = (raw as Buffer).toString("utf8");
                this.reader.out.put({ connectionId: id, data });
            });

            ws.on("close", () => {
                this._sockets.delete(id);
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
                    wss.close(() => {
                        httpServer.closeAllConnections?.();
                        httpServer.close(() => resolve());
                    });
                }),
        });

        await new Promise<void>((resolve, reject) => {
            httpServer.listen(this._port, this._host ?? "127.0.0.1", resolve);
            httpServer.once("error", reject);
        });
    }

    private async _handleUpgrade(
        wss: WsServerType,
        req: IncomingMessage,
        socket: Duplex,
        head: Buffer,
    ): Promise<void> {
        const origin = headerValue(req.headers.origin);

        // 1. Origin allow-list (CSWSH defense) — checked before authentication so
        //    a cross-site attacker never reaches credential validation.
        if (!this._originAllowed(origin)) {
            rejectUpgrade(socket, 403, "Forbidden");
            return;
        }

        // 2. Upgrade-time authentication. A null principal rejects the upgrade.
        let principal: WsPrincipal | null = null;
        if (this._authenticate !== undefined) {
            try {
                principal = await this._authenticate(req);
            } catch {
                principal = null;
            }
            if (principal === null) {
                rejectUpgrade(socket, 401, "Unauthorized");
                return;
            }
        }

        const connection: WsConnection = {
            connectionId: hexId(uuidv4Binary()),
            principal,
            origin,
            remoteAddress: req.socket.remoteAddress ?? null,
        };

        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit("connection", ws, req, connection);
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
