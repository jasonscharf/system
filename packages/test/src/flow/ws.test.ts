import type { IncomingMessage } from "node:http";
import {
    FlowApp,
    FlowComponent,
    type FlowComponentOptions,
    FlowContext,
    type FlowPort,
    WebSocketClient,
    WebSocketReader,
    WebSocketServer,
    WebSocketWriter,
    type WsConnection,
    type WsMessage,
    type WsPrincipal,
} from "@jasonscharf/flow";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket as WsClient } from "ws";

// ── Helper: wait for a port to receive a message ─────────────────────────────

async function waitForMessage<T>(port: FlowPort<T>, timeoutMs = 2000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const msg = port.read();
        if (msg !== undefined) {
            return msg;
        }
        await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`Timeout waiting for message on port "${port.name}"`);
}

// ── Helper: find a free TCP port ─────────────────────────────────────────────

async function freePort(): Promise<number> {
    const net = await import("node:net");
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.listen(0, () => {
            const addr = srv.address();
            srv.close(() => resolve((addr as { port: number }).port));
        });
        srv.on("error", reject);
    });
}

// ── Uppercase-transform helper component ────────────────────────────────────

class UppercaseTransform extends FlowComponent {
    readonly in: FlowPort<WsMessage>;
    readonly out: FlowPort<WsMessage>;

    constructor(options: FlowComponentOptions) {
        super(options);
        this.in = this.addPort<WsMessage>("in", "in");
        this.out = this.addPort<WsMessage>("out", "out");
    }

    override step(): void {
        for (;;) {
            const msg = this.in.read();
            if (msg === undefined) {
                break;
            }
            this.out.put({
                connectionId: msg.connectionId,
                data: typeof msg.data === "string" ? msg.data.toUpperCase() : msg.data,
            });
        }
    }
}

// ── WebSocketReader ───────────────────────────────────────────────────────────

describe("WebSocketReader", () => {
    it("has an out port with direction out", () => {
        const ctx = new FlowContext();
        const r = new WebSocketReader({ name: "reader", context: ctx });
        expect(r.out.direction).toBe("out");
    });

    it("out.put() enqueues a WsMessage on the out port", () => {
        const ctx = new FlowContext();
        const r = new WebSocketReader({ name: "reader", context: ctx });
        const msg: WsMessage = { connectionId: "abc", data: "hello" };
        r.out.put(msg);
        expect(r.out.read()).toEqual(msg);
    });
});

// ── WebSocketWriter ───────────────────────────────────────────────────────────

describe("WebSocketWriter", () => {
    it("has an in port with direction in", () => {
        const ctx = new FlowContext();
        const w = new WebSocketWriter({ name: "writer", context: ctx, send: () => {} });
        expect(w.in.direction).toBe("in");
    });

    it("step() calls the send function for each queued message", () => {
        const ctx = new FlowContext();
        const sent: Array<{ id: string; data: string | Uint8Array }> = [];
        const w = new WebSocketWriter({
            name: "writer",
            context: ctx,
            send: (id, data) => sent.push({ id, data }),
        });

        w.in.put({ connectionId: "c1", data: "foo" });
        w.in.put({ connectionId: "c2", data: "bar" });
        w.step();

        expect(sent).toEqual([
            { id: "c1", data: "foo" },
            { id: "c2", data: "bar" },
        ]);
    });

    it("step() is a no-op when in port is empty", () => {
        const ctx = new FlowContext();
        let called = false;
        const w = new WebSocketWriter({
            name: "writer",
            context: ctx,
            send: () => {
                called = true;
            },
        });
        w.step();
        expect(called).toBe(false);
    });
});

// ── WebSocketServer (unit) ────────────────────────────────────────────────────

describe("WebSocketServer (unit)", () => {
    it("exposes received, send, connected, disconnected ports", () => {
        const app = new FlowApp();
        const server = new WebSocketServer({ name: "srv", context: app.context, port: 0 });
        expect(server.received.direction).toBe("out");
        expect(server.send.direction).toBe("in");
        expect(server.connected.direction).toBe("out");
        expect(server.disconnected.direction).toBe("out");
    });

    it("has reader and writer as named child components", () => {
        const app = new FlowApp();
        const server = new WebSocketServer({ name: "srv", context: app.context, port: 0 });
        expect(server.children).toContain(server.reader);
        expect(server.children).toContain(server.writer);
    });

    it("step() forwards server.send to writer.in", () => {
        const app = new FlowApp();
        const server = new WebSocketServer({ name: "srv", context: app.context, port: 0 });
        const msg: WsMessage = { connectionId: "x", data: "hi" };
        server.send.put(msg);
        server.step();
        expect(server.writer.in.read()).toEqual(msg);
    });
});

// ── WebSocketClient (unit) ────────────────────────────────────────────────────

describe("WebSocketClient (unit)", () => {
    it("exposes send and received ports", () => {
        const app = new FlowApp();
        const client = new WebSocketClient({
            name: "cli",
            context: app.context,
            url: "ws://localhost:0",
        });
        expect(client.send.direction).toBe("in");
        expect(client.received.direction).toBe("out");
        expect(client.connected.direction).toBe("out");
        expect(client.disconnected.direction).toBe("out");
    });
});

// ── Integration: echo server with uppercase transform ────────────────────────

describe("WebSocket echo integration", () => {
    let app: FlowApp;
    let server: WebSocketServer;
    let client: WebSocketClient;
    let port: number;

    beforeEach(async () => {
        port = await freePort();
        app = new FlowApp({ mode: "push" });

        server = new WebSocketServer({ name: "server", context: app.context, port });
        const transform = new UppercaseTransform({ name: "upper", context: app.context });
        client = new WebSocketClient({
            name: "client",
            context: app.context,
            url: `ws://127.0.0.1:${port}`,
        });

        app.addComponent(server)
            .addComponent(transform)
            .addComponent(client)
            .connect(server.received, transform.in)
            .connect(transform.out, server.send);

        await app.start();
        app.scheduler.start();
    });

    afterEach(async () => {
        await app.stop();
    });

    it("receives an uppercase echo for each message sent", async () => {
        client.send.put("hello world");
        const echo = await waitForMessage(client.received);
        expect(echo).toBe("HELLO WORLD");
    });

    it("handles multiple messages in sequence", async () => {
        client.send.put("foo");
        const r1 = await waitForMessage(client.received);
        expect(r1).toBe("FOO");

        client.send.put("bar");
        const r2 = await waitForMessage(client.received);
        expect(r2).toBe("BAR");
    });

    it("server emits connected id when client connects", async () => {
        const id = await waitForMessage(server.connected);
        expect(typeof id).toBe("string");
        expect(id.length).toBeGreaterThan(0);
    });
});

// ── Additional coverage ───────────────────────────────────────────────────────

describe("WebSocketClient.onInit() guard", () => {
    it("throws when globalThis.WebSocket is undefined", async () => {
        const app = new FlowApp();
        const client = new WebSocketClient({
            name: "cli",
            context: app.context,
            url: "ws://localhost:9999",
        });
        const original = globalThis.WebSocket;
        try {
            // @ts-expect-error deliberately remove global WebSocket
            globalThis.WebSocket = undefined;
            await expect(client.init()).rejects.toThrow("platform-native WebSocket");
        } finally {
            globalThis.WebSocket = original;
        }
    });
});

describe("WebSocketReader.step()", () => {
    it("step() is a no-op when out port is empty", () => {
        const ctx = new FlowContext();
        const r = new WebSocketReader({ name: "r", context: ctx });
        // Should not throw and not change state
        expect(() => r.step()).not.toThrow();
        expect(r.out.size).toBe(0);
    });
});

describe("WebSocketServer message non-Buffer path", () => {
    it("handles string messages from the ws library", async () => {
        const freePort = () =>
            new Promise<number>((resolve, reject) => {
                import("node:net").then(({ createServer }) => {
                    const srv = createServer();
                    srv.listen(0, () => {
                        const addr = srv.address() as { port: number };
                        srv.close(() => resolve(addr.port));
                    });
                    srv.on("error", reject);
                });
            });

        const port = await freePort();
        const app = new FlowApp({ mode: "push" });
        const server = new WebSocketServer({ name: "srv", context: app.context, port });
        app.addComponent(server);
        await app.start();
        app.scheduler.start();

        // Connect a native WebSocket client and send a string message
        const ws = new globalThis.WebSocket(`ws://127.0.0.1:${port}`);
        await new Promise<void>((res, rej) => {
            ws.addEventListener("open", () => res());
            ws.addEventListener("error", rej);
        });
        ws.send("hello string");
        await new Promise((r) => setTimeout(r, 100));

        // The reader should have injected the message
        const msg = server.received.read();
        expect(msg?.data).toBe("hello string");

        ws.close();
        await app.stop();
    });
});

// ── WebSocketClient: ArrayBuffer message → Uint8Array conversion ──────────────

describe("WebSocketClient: binary message handling", () => {
    it("converts ArrayBuffer message to Uint8Array on received port", async () => {
        const freePort = () =>
            new Promise<number>((resolve, reject) => {
                import("node:net").then(({ createServer }) => {
                    const srv = createServer();
                    srv.listen(0, () => {
                        const addr = srv.address() as { port: number };
                        srv.close(() => resolve(addr.port));
                    });
                    srv.on("error", reject);
                });
            });

        const port = await freePort();
        const app = new FlowApp({ mode: "push" });
        const server = new WebSocketServer({ name: "srv", context: app.context, port });
        app.addComponent(server);
        await app.start();
        app.scheduler.start();

        const client = new WebSocketClient({
            name: "cli",
            context: app.context,
            url: `ws://127.0.0.1:${port}`,
        });
        await client.init();

        // Wait for server to register the connection
        await new Promise((r) => setTimeout(r, 50));
        const connId = server.connected.read();
        if (connId == null) {
            throw new Error("expected a connection id from server.connected");
        }

        // Server sends binary to client
        server.send.put({ connectionId: connId, data: new Uint8Array([10, 20, 30]) });
        app.scheduler.tick();
        await new Promise((r) => setTimeout(r, 100));

        const msg = client.received.read();
        expect(msg).toBeInstanceOf(Uint8Array);

        await client.dispose();
        await app.stop();
    });
});

// ── Upgrade-time auth + origin allow-list (TRN-173) ──────────────────────────

/**
 * A real downstream component that records the principal it resolves for each
 * inbound WsMessage by asking the server's connection map. This is the FBP
 * observability layer for "downstream can resolve the connection's principal" —
 * not a spy.
 */
class PrincipalCollector extends FlowComponent {
    readonly in: FlowPort<WsMessage>;
    readonly seen: WsPrincipal[] = [];

    constructor(
        options: FlowComponentOptions,
        private readonly _server: WebSocketServer,
    ) {
        super(options);
        this.in = this.addPort<WsMessage>("in", "in");
    }

    override step(): void {
        for (;;) {
            const msg = this.in.read();
            if (msg === undefined) {
                break;
            }
            const conn = this._server.getConnection(msg.connectionId);
            if (conn?.principal != null) {
                this.seen.push(conn.principal);
            }
        }
    }
}

// A real authenticate implementation: it reads a bearer token from the
// Authorization header (or an "auth" cookie) and returns a principal for the
// known token, otherwise null. This is a genuine implementation, not a mock.
function tokenAuthenticate(req: IncomingMessage): Promise<WsPrincipal | null> {
    const header = req.headers.authorization ?? null;
    const cookie = req.headers.cookie ?? null;
    const bearer = header?.startsWith("Bearer ") ? header.slice(7) : null;
    const cookieToken =
        cookie
            ?.split(";")
            .map((c) => c.trim())
            .find((c) => c.startsWith("auth="))
            ?.slice("auth=".length) ?? null;
    const token = bearer ?? cookieToken;
    if (token === "good-token") {
        return Promise.resolve({ sub: "user-42", token });
    }
    return Promise.resolve(null);
}

async function connectWs(
    url: string,
    headers: Record<string, string>,
): Promise<{ ok: boolean; status: number | null; ws: WsClient | null }> {
    const ws = new WsClient(url, { headers });
    return new Promise((resolve) => {
        ws.on("open", () => resolve({ ok: true, status: 101, ws }));
        ws.on("unexpected-response", (_req, res) => {
            ws.terminate();
            resolve({ ok: false, status: res.statusCode ?? null, ws: null });
        });
        ws.on("error", () => resolve({ ok: false, status: null, ws: null }));
    });
}

describe("WebSocketServer upgrade authentication (TRN-173)", () => {
    let app: FlowApp;
    let server: WebSocketServer;
    let collector: PrincipalCollector;
    let port: number;

    beforeEach(async () => {
        port = await freePort();
        app = new FlowApp({ mode: "push" });
        server = new WebSocketServer({
            name: "server",
            context: app.context,
            port,
            authenticate: tokenAuthenticate,
            allowedOrigins: ["https://app.example.com"],
        });
        collector = new PrincipalCollector({ name: "collector", context: app.context }, server);
        app.addComponent(server).addComponent(collector).connect(server.received, collector.in);
        await app.start();
        app.scheduler.start();
    });

    afterEach(async () => {
        await app.stop();
    });

    it("refuses an upgrade with no credentials (401)", async () => {
        const result = await connectWs(`ws://127.0.0.1:${port}`, {
            origin: "https://app.example.com",
        });
        expect(result.ok).toBe(false);
        expect(result.status).toBe(401);
    });

    it("refuses an upgrade with an invalid token (401)", async () => {
        const result = await connectWs(`ws://127.0.0.1:${port}`, {
            origin: "https://app.example.com",
            authorization: "Bearer wrong-token",
        });
        expect(result.ok).toBe(false);
        expect(result.status).toBe(401);
    });

    it("accepts a valid token and a downstream component resolves the principal", async () => {
        const result = await connectWs(`ws://127.0.0.1:${port}`, {
            origin: "https://app.example.com",
            authorization: "Bearer good-token",
        });
        expect(result.ok).toBe(true);
        expect(result.ws).not.toBeNull();

        const connId = await waitForMessage(server.connected);
        expect(typeof connId).toBe("string");

        // The principal is stamped on the connection map at upgrade.
        const conn = server.getConnection(connId);
        expect(conn).not.toBeNull();
        expect((conn as WsConnection).principal).toEqual({
            sub: "user-42",
            token: "good-token",
        });
        expect(server.getPrincipal(connId)).toEqual({ sub: "user-42", token: "good-token" });

        // A downstream component reading `received` resolves the same principal.
        result.ws?.send("hello");
        const deadline = Date.now() + 2000;
        while (collector.seen.length === 0 && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 10));
        }
        expect(collector.seen).toEqual([{ sub: "user-42", token: "good-token" }]);

        result.ws?.close();
    });

    it("accepts a valid token presented via cookie", async () => {
        const result = await connectWs(`ws://127.0.0.1:${port}`, {
            origin: "https://app.example.com",
            cookie: "auth=good-token; other=1",
        });
        expect(result.ok).toBe(true);
        result.ws?.close();
    });

    it("rejects a disallowed Origin (403) before authenticating", async () => {
        const result = await connectWs(`ws://127.0.0.1:${port}`, {
            origin: "https://evil.example.com",
            authorization: "Bearer good-token",
        });
        expect(result.ok).toBe(false);
        expect(result.status).toBe(403);
    });

    it("rejects a missing Origin when an allow-list is set (403)", async () => {
        const result = await connectWs(`ws://127.0.0.1:${port}`, {
            authorization: "Bearer good-token",
        });
        expect(result.ok).toBe(false);
        expect(result.status).toBe(403);
    });
});

describe("WebSocketServer open server (no auth, no origin list)", () => {
    let app: FlowApp;
    let server: WebSocketServer;
    let port: number;

    beforeEach(async () => {
        port = await freePort();
        app = new FlowApp({ mode: "push" });
        server = new WebSocketServer({ name: "server", context: app.context, port });
        app.addComponent(server);
        await app.start();
        app.scheduler.start();
    });

    afterEach(async () => {
        await app.stop();
    });

    it("accepts any connection and exposes a null principal", async () => {
        const result = await connectWs(`ws://127.0.0.1:${port}`, {
            origin: "https://anywhere.example.com",
        });
        expect(result.ok).toBe(true);

        const connId = await waitForMessage(server.connected);
        const conn = server.getConnection(connId);
        expect(conn).not.toBeNull();
        expect((conn as WsConnection).principal).toBeNull();
        expect(server.getPrincipal(connId)).toBeNull();

        result.ws?.close();
    });

    it("getConnection returns null for an unknown connection id", () => {
        expect(server.getConnection("does-not-exist")).toBeNull();
        expect(server.getPrincipal("does-not-exist")).toBeNull();
    });
});

// ── TRN-528: detached upgrade handler is tracked for graceful drain ──────────
//
// The upgrade handler was fired with `void this._handleUpgrade(...)`. It is now
// registered as in-flight work so FlowApp.stop() drains an in-progress upgrade
// before disposing, and any unexpected error rejects the socket instead of
// becoming an unhandled rejection. A gated (real) authenticate keeps the upgrade
// genuinely in flight so the tracking is observable over a real socket.

describe("WebSocketServer: in-flight upgrade is tracked for graceful drain (TRN-528)", () => {
    it("reports inFlight while an upgrade authenticates and drains to zero after", async () => {
        const port = await freePort();
        const app = new FlowApp({ mode: "push" });

        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const server = new WebSocketServer({
            name: "srv",
            context: app.context,
            port,
            authenticate: async () => {
                await gate;
                return { sub: "u1", token: "t" };
            },
        });
        app.addComponent(server);
        await app.start();
        app.scheduler.start();

        // Initiate a real upgrade but do not await it — authenticate is gated.
        const connecting = connectWs(`ws://127.0.0.1:${port}`, {});

        const deadline = Date.now() + 1000;
        while (server.inFlight === 0 && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 5));
        }
        expect(server.inFlight).toBe(1);

        release();
        const result = await connecting;
        expect(result.ok).toBe(true);

        const drainDeadline = Date.now() + 1000;
        while (server.inFlight > 0 && Date.now() < drainDeadline) {
            await new Promise((r) => setTimeout(r, 5));
        }
        expect(server.inFlight).toBe(0);

        result.ws?.close();
        await app.stop();
    });
});

describe("WebSocketServer authenticate that throws is treated as rejection", () => {
    it("rejects with 401 when the authenticate callback throws", async () => {
        const port = await freePort();
        const app = new FlowApp({ mode: "push" });
        const server = new WebSocketServer({
            name: "server",
            context: app.context,
            port,
            authenticate: () => {
                throw new Error("boom");
            },
        });
        app.addComponent(server);
        await app.start();
        app.scheduler.start();

        const result = await connectWs(`ws://127.0.0.1:${port}`, {
            origin: "https://app.example.com",
        });
        expect(result.ok).toBe(false);
        expect(result.status).toBe(401);

        await app.stop();
    });
});
