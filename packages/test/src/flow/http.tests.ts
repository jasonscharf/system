import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    FlowApp,
    FlowComponent,
    FlowContext,
    FlowPort,
    type FlowComponentOptions,
    HttpEncoder,
    HttpDecoder,
    HttpServer,
    HttpClient,
    type HttpMethod,
    type HttpRequest,
    type HttpResponse,
    type HttpRequestDraft,
    type HttpResponseDraft,
    type ParsedHttpRequest,
    type ParsedHttpResponse,
} from '@system/flow';


// ── Helpers ───────────────────────────────────────────────────────────────────

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

async function waitForMessage<T>(port: FlowPort<T>, timeoutMs = 3000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const msg = port.read();
        if (msg !== undefined) return msg;
        await new Promise(r => setTimeout(r, 10));
    }
    throw new Error(`Timeout waiting for message on port "${port.name}"`);
}


// ── HttpEncoder ───────────────────────────────────────────────────────────────

describe('HttpEncoder', () => {
    let ctx: FlowContext;
    let enc: HttpEncoder;

    beforeEach(() => {
        ctx = new FlowContext();
        enc = new HttpEncoder({ name: 'enc', context: ctx });
    });

    it('has requestIn/requestOut and responseIn/responseOut ports', () => {
        expect(enc.requestIn.direction).toBe('in');
        expect(enc.requestOut.direction).toBe('out');
        expect(enc.responseIn.direction).toBe('in');
        expect(enc.responseOut.direction).toBe('out');
    });

    it('encodes a JSON body and sets Content-Type header', () => {
        enc.requestIn.put({ method: 'POST', url: '/foo', body: { name: 'Alice' } });
        enc.step();
        const out = enc.requestOut.read()!;
        expect(out.body).toBe(JSON.stringify({ name: 'Alice' }));
        expect(String(out.headers['content-type'])).toContain('application/json');
    });

    it('encodes a string body as text/plain by default', () => {
        enc.requestIn.put({ method: 'POST', url: '/foo', body: 'hello' });
        enc.step();
        const out = enc.requestOut.read()!;
        expect(out.body).toBe('hello');
        expect(String(out.headers['content-type'])).toContain('text/plain');
    });

    it('encodes Uint8Array as application/octet-stream', () => {
        const bytes = new Uint8Array([1, 2, 3]);
        enc.requestIn.put({ method: 'POST', url: '/bin', body: bytes });
        enc.step();
        const out = enc.requestOut.read()!;
        expect(out.body).toEqual(bytes);
        expect(String(out.headers['content-type'])).toContain('application/octet-stream');
    });

    it('encodes form-urlencoded when contentType is set', () => {
        enc.requestIn.put({
            method: 'POST', url: '/form',
            body: { a: '1', b: '2' },
            contentType: 'application/x-www-form-urlencoded',
        });
        enc.step();
        const out = enc.requestOut.read()!;
        expect(out.body).toContain('a=1');
        expect(out.body).toContain('b=2');
    });

    it('omits body and Content-Type for requests without body', () => {
        enc.requestIn.put({ method: 'GET', url: '/ping' });
        enc.step();
        const out = enc.requestOut.read()!;
        expect(out.body).toBeUndefined();
        expect(out.headers['content-type']).toBeUndefined();
    });

    it('encodes response drafts with status and body', () => {
        enc.responseIn.put({ requestId: 'r1', status: 200, body: { ok: true } });
        enc.step();
        const out = enc.responseOut.read()!;
        expect(out.requestId).toBe('r1');
        expect(out.status).toBe(200);
        expect(out.body).toBe(JSON.stringify({ ok: true }));
    });

    it('defaults response status to 200', () => {
        enc.responseIn.put({ body: 'pong' });
        enc.step();
        const out = enc.responseOut.read()!;
        expect(out.status).toBe(200);
    });

    it('passes through explicit headers untouched', () => {
        enc.requestIn.put({ method: 'GET', url: '/', headers: { 'x-custom': 'val' } });
        enc.step();
        const out = enc.requestOut.read()!;
        expect(out.headers['x-custom']).toBe('val');
    });

    it('processes multiple requests and responses in one step', () => {
        enc.requestIn.put({ method: 'GET', url: '/a' });
        enc.requestIn.put({ method: 'GET', url: '/b' });
        enc.responseIn.put({ status: 201, body: 'c' });
        enc.step();
        expect(enc.requestOut.size).toBe(2);
        expect(enc.responseOut.size).toBe(1);
    });
});


// ── HttpDecoder ───────────────────────────────────────────────────────────────

describe('HttpDecoder', () => {
    let ctx: FlowContext;
    let dec: HttpDecoder;

    beforeEach(() => {
        ctx = new FlowContext();
        dec = new HttpDecoder({ name: 'dec', context: ctx });
    });

    it('has requestIn/requestOut and responseIn/responseOut ports', () => {
        expect(dec.requestIn.direction).toBe('in');
        expect(dec.requestOut.direction).toBe('out');
        expect(dec.responseIn.direction).toBe('in');
        expect(dec.responseOut.direction).toBe('out');
    });

    it('decodes a JSON request body', () => {
        dec.requestIn.put({
            method: 'POST', url: '/api',
            headers: { 'content-type': 'application/json' },
            body: '{"x":1}',
        });
        dec.step();
        const out = dec.requestOut.read()!;
        expect(out.body).toEqual({ x: 1 });
        expect(out.contentType).toContain('application/json');
    });

    it('decodes a form-urlencoded request body', () => {
        dec.requestIn.put({
            method: 'POST', url: '/form',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: 'a=1&b=hello+world',
        });
        dec.step();
        const out = dec.requestOut.read()!;
        expect((out.body as Record<string, string>)['a']).toBe('1');
        expect((out.body as Record<string, string>)['b']).toBe('hello world');
    });

    it('decodes a text/plain request body as string', () => {
        dec.requestIn.put({
            method: 'POST', url: '/text',
            headers: { 'content-type': 'text/plain' },
            body: 'raw text',
        });
        dec.step();
        expect(dec.requestOut.read()!.body).toBe('raw text');
    });

    it('leaves body undefined when no body is present', () => {
        dec.requestIn.put({ method: 'GET', url: '/', headers: {} });
        dec.step();
        expect(dec.requestOut.read()!.body).toBeUndefined();
    });

    it('populates pathname and searchParams from url', () => {
        dec.requestIn.put({ method: 'GET', url: '/users?page=2&limit=10', headers: {} });
        dec.step();
        const out = dec.requestOut.read()!;
        expect(out.pathname).toBe('/users');
        expect(out.searchParams.get('page')).toBe('2');
        expect(out.searchParams.get('limit')).toBe('10');
    });

    it('decodes JSON response body', () => {
        dec.responseIn.put({
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: '{"id":42}',
        });
        dec.step();
        const out = dec.responseOut.read()!;
        expect(out.body).toEqual({ id: 42 });
        expect(out.ok).toBe(true);
    });

    it('sets ok=false for 4xx/5xx responses', () => {
        dec.responseIn.put({ status: 404, headers: {}, body: 'not found' });
        dec.step();
        expect(dec.responseOut.read()!.ok).toBe(false);
    });

    it('round-trips through encoder then decoder', () => {
        const ctx2 = new FlowContext();
        const enc = new HttpEncoder({ name: 'e', context: ctx2 });
        const dec2 = new HttpDecoder({ name: 'd', context: ctx2 });
        const payload = { greeting: 'hello', count: 3 };

        enc.requestIn.put({ method: 'POST', url: '/echo', body: payload });
        enc.step();

        const encoded = enc.requestOut.read()!;
        dec2.requestIn.put(encoded);
        dec2.step();

        expect(dec2.requestOut.read()!.body).toEqual(payload);
    });
});


// ── HttpServer (unit) ─────────────────────────────────────────────────────────

describe('HttpServer (unit)', () => {
    it('exposes requests and responses ports', () => {
        const app = new FlowApp();
        const srv = new HttpServer({ name: 'srv', context: app.context, port: 0 });
        expect(srv.requests.direction).toBe('out');
        expect(srv.responses.direction).toBe('in');
    });

    it('has reader and writer as children', () => {
        const app = new FlowApp();
        const srv = new HttpServer({ name: 'srv', context: app.context, port: 0 });
        expect(srv.children).toContain(srv.reader);
        expect(srv.children).toContain(srv.writer);
    });

    it('step() forwards responses port to writer.in', () => {
        const app = new FlowApp();
        const srv = new HttpServer({ name: 'srv', context: app.context, port: 0 });
        const resp: HttpResponse = { requestId: 'r1', status: 200, headers: {}, body: 'hi' };
        srv.responses.put(resp);
        srv.step();
        expect(srv.writer.in.read()).toEqual(resp);
    });
});


// ── HttpClient (unit) ─────────────────────────────────────────────────────────

describe('HttpClient (unit)', () => {
    it('exposes requests and responses ports', () => {
        const app = new FlowApp();
        const cli = new HttpClient({ name: 'cli', context: app.context });
        expect(cli.requests.direction).toBe('in');
        expect(cli.responses.direction).toBe('out');
    });
});


// ── Integration: full HTTP echo pipeline ─────────────────────────────────────

describe('HTTP echo integration', () => {
    // EchoHandler: reads parsed requests, emits response drafts with body uppercased
    class EchoHandler extends FlowComponent {
        readonly in: FlowPort<ParsedHttpRequest>;
        readonly out: FlowPort<HttpResponseDraft>;

        constructor(options: FlowComponentOptions) {
            super(options);
            this.in = this.addPort<ParsedHttpRequest>('in', 'in');
            this.out = this.addPort<HttpResponseDraft>('out', 'out');
        }

        override step(): void {
            let req: ParsedHttpRequest | undefined;
            while ((req = this.in.read()) !== undefined) {
                this.out.put({
                    requestId: req.requestId,
                    status: 200,
                    contentType: 'text/plain',
                    body: typeof req.body === 'string' ? req.body.toUpperCase() : 'OK',
                });
            }
        }
    }

    let app: FlowApp;
    let server: HttpServer;
    let port: number;
    let baseUrl: string;

    beforeEach(async () => {
        port = await freePort();
        baseUrl = `http://127.0.0.1:${port}`;

        app = new FlowApp({ mode: 'push' });

        server = new HttpServer({ name: 'server', context: app.context, port });
        const dec = new HttpDecoder({ name: 'dec', context: app.context });
        const handler = new EchoHandler({ name: 'handler', context: app.context });
        const enc = new HttpEncoder({ name: 'enc', context: app.context });

        // server.requests → dec.requestIn → dec.requestOut → handler.in → handler.out
        //   → enc.responseIn → enc.responseOut → server.responses
        app
            .addComponent(server)
            .addComponent(dec)
            .addComponent(handler)
            .addComponent(enc)
            .connect(server.requests, dec.requestIn)
            .connect(dec.requestOut, handler.in)
            .connect(handler.out, enc.responseIn)
            .connect(enc.responseOut, server.responses);

        await app.start();
        app.scheduler.start();
    });

    afterEach(async () => {
        await app.stop();
    });

    it('echoes a POST body in uppercase via fetch', async () => {
        const res = await fetch(`${baseUrl}/echo`, {
            method: 'POST',
            headers: { 'content-type': 'text/plain' },
            body: 'hello world',
        });
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('HELLO WORLD');
    });

    it('handles GET requests with no body', async () => {
        const res = await fetch(`${baseUrl}/ping`);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('OK');
    });

    it('HttpClient can send a request and receive a response', async () => {
        const client = new HttpClient({ name: 'cli', context: app.context });
        await client.init();

        client.requests.put({ method: 'POST', url: `${baseUrl}/test`, headers: {}, body: 'hi' });
        app.scheduler.tick(); // step client → fires fetch

        const response = await waitForMessage(client.responses);
        expect(response.status).toBe(200);
        expect(response.body).toBe('HI');

        await client.dispose();
    });

    it('handles concurrent requests correctly', async () => {
        const [r1, r2, r3] = await Promise.all([
            fetch(`${baseUrl}/`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'a' }),
            fetch(`${baseUrl}/`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'b' }),
            fetch(`${baseUrl}/`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'c' }),
        ]);
        expect(await r1.text()).toBe('A');
        expect(await r2.text()).toBe('B');
        expect(await r3.text()).toBe('C');
    });
});
