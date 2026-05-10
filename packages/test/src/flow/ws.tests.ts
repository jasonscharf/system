import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    FlowApp,
    FlowComponent,
    FlowContext,
    FlowPort,
    type FlowComponentOptions,
    type WsMessage,
    WebSocketReader,
    WebSocketWriter,
    WebSocketServer,
    WebSocketClient,
} from '@system/flow';


// ── Helper: wait for a port to receive a message ─────────────────────────────

async function waitForMessage<T>(port: FlowPort<T>, timeoutMs = 2000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const msg = port.read();
        if (msg !== undefined) return msg;
        await new Promise(r => setTimeout(r, 10));
    }
    throw new Error(`Timeout waiting for message on port "${port.name}"`);
}

// ── Helper: find a free TCP port ─────────────────────────────────────────────

async function freePort(): Promise<number> {
    const net = await import('node:net');
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.listen(0, () => {
            const addr = srv.address();
            srv.close(() => resolve((addr as net.AddressInfo).port));
        });
        srv.on('error', reject);
    });
}


// ── Uppercase-transform helper component ────────────────────────────────────

class UppercaseTransform extends FlowComponent {
    readonly in: FlowPort<WsMessage>;
    readonly out: FlowPort<WsMessage>;

    constructor(options: FlowComponentOptions) {
        super(options);
        this.in = this.addPort<WsMessage>('in', 'in');
        this.out = this.addPort<WsMessage>('out', 'out');
    }

    override step(): void {
        let msg: WsMessage | undefined;
        while ((msg = this.in.read()) !== undefined) {
            this.out.put({
                connectionId: msg.connectionId,
                data: typeof msg.data === 'string' ? msg.data.toUpperCase() : msg.data,
            });
        }
    }
}


// ── WebSocketReader ───────────────────────────────────────────────────────────

describe('WebSocketReader', () => {
    it('has an out port with direction out', () => {
        const ctx = new FlowContext();
        const r = new WebSocketReader({ name: 'reader', context: ctx });
        expect(r.out.direction).toBe('out');
    });

    it('_inject puts a WsMessage on the out port', () => {
        const ctx = new FlowContext();
        const r = new WebSocketReader({ name: 'reader', context: ctx });
        const msg: WsMessage = { connectionId: 'abc', data: 'hello' };
        r._inject(msg);
        expect(r.out.read()).toEqual(msg);
    });
});


// ── WebSocketWriter ───────────────────────────────────────────────────────────

describe('WebSocketWriter', () => {
    it('has an in port with direction in', () => {
        const ctx = new FlowContext();
        const w = new WebSocketWriter({ name: 'writer', context: ctx });
        expect(w.in.direction).toBe('in');
    });

    it('step() calls the send function for each queued message', () => {
        const ctx = new FlowContext();
        const w = new WebSocketWriter({ name: 'writer', context: ctx });
        const sent: Array<{ id: string; data: string | Uint8Array }> = [];
        w._setSend((id, data) => sent.push({ id, data }));

        w.in.put({ connectionId: 'c1', data: 'foo' });
        w.in.put({ connectionId: 'c2', data: 'bar' });
        w.step();

        expect(sent).toEqual([
            { id: 'c1', data: 'foo' },
            { id: 'c2', data: 'bar' },
        ]);
    });

    it('step() is a no-op when in port is empty', () => {
        const ctx = new FlowContext();
        const w = new WebSocketWriter({ name: 'writer', context: ctx });
        let called = false;
        w._setSend(() => { called = true; });
        w.step();
        expect(called).toBe(false);
    });
});


// ── WebSocketServer (unit) ────────────────────────────────────────────────────

describe('WebSocketServer (unit)', () => {
    it('exposes received, send, connected, disconnected ports', () => {
        const app = new FlowApp();
        const server = new WebSocketServer({ name: 'srv', context: app.context, port: 0 });
        expect(server.received.direction).toBe('out');
        expect(server.send.direction).toBe('in');
        expect(server.connected.direction).toBe('out');
        expect(server.disconnected.direction).toBe('out');
    });

    it('has reader and writer as named child components', () => {
        const app = new FlowApp();
        const server = new WebSocketServer({ name: 'srv', context: app.context, port: 0 });
        expect(server.children).toContain(server.reader);
        expect(server.children).toContain(server.writer);
    });

    it('step() forwards server.send to writer.in', () => {
        const app = new FlowApp();
        const server = new WebSocketServer({ name: 'srv', context: app.context, port: 0 });
        const msg: WsMessage = { connectionId: 'x', data: 'hi' };
        server.send.put(msg);
        server.step();
        expect(server.writer.in.read()).toEqual(msg);
    });
});


// ── WebSocketClient (unit) ────────────────────────────────────────────────────

describe('WebSocketClient (unit)', () => {
    it('exposes send and received ports', () => {
        const app = new FlowApp();
        const client = new WebSocketClient({ name: 'cli', context: app.context, url: 'ws://localhost:0' });
        expect(client.send.direction).toBe('in');
        expect(client.received.direction).toBe('out');
        expect(client.connected.direction).toBe('out');
        expect(client.disconnected.direction).toBe('out');
    });
});


// ── Integration: echo server with uppercase transform ────────────────────────

describe('WebSocket echo integration', () => {
    let app: FlowApp;
    let server: WebSocketServer;
    let client: WebSocketClient;
    let port: number;

    beforeEach(async () => {
        port = await freePort();
        app = new FlowApp({ mode: 'push' });

        server = new WebSocketServer({ name: 'server', context: app.context, port });
        const transform = new UppercaseTransform({ name: 'upper', context: app.context });
        client = new WebSocketClient({ name: 'client', context: app.context, url: `ws://127.0.0.1:${port}` });

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

    it('receives an uppercase echo for each message sent', async () => {
        client.send.put('hello world');
        const echo = await waitForMessage(client.received);
        expect(echo).toBe('HELLO WORLD');
    });

    it('handles multiple messages in sequence', async () => {
        client.send.put('foo');
        const r1 = await waitForMessage(client.received);
        expect(r1).toBe('FOO');

        client.send.put('bar');
        const r2 = await waitForMessage(client.received);
        expect(r2).toBe('BAR');
    });

    it('server emits connected id when client connects', async () => {
        const id = await waitForMessage(server.connected);
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
    });
});
