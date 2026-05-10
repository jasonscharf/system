/**
 * Example: streaming a binary file by name over HTTP.
 *
 * Pipeline:
 *
 *   GET /?name=<file>
 *         │
 *   HttpServer.requests
 *         │
 *   HttpDecoder.requestIn ──► HttpDecoder.requestOut   (ParsedHttpRequest)
 *         │
 *   FileStreamHandler.in  ──► FileStreamHandler.out    (HttpStreamResponse)
 *         │
 *   HttpServer.streamingResponses
 *         │
 *   _sendStream() ──► res.write(chunk) × N ──► res.end()
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    FlowApp,
    HttpDecoder,
    HttpServer,
    FileStreamHandler,
    type ParsedHttpRequest,
} from '@system/flow';


// ── Helpers ───────────────────────────────────────────────────────────────────

async function freePort(): Promise<number> {
    const net = await import('node:net');
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.listen(0, () => {
            const addr = srv.address();
            srv.close(() => resolve((addr as { port: number }).port));
        });
        srv.on('error', reject);
    });
}

/** Deterministic pseudo-random bytes — reproducible across runs. */
function makeBytes(seed: number, length: number): Uint8Array {
    const buf = new Uint8Array(length);
    let s = seed;
    for (let i = 0; i < length; i++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        buf[i] = s & 0xff;
    }
    return buf;
}


// ── Fixture ───────────────────────────────────────────────────────────────────

describe('FileStreamHandler (unit)', () => {
    it('exposes in (ParsedHttpRequest) and out (HttpStreamResponse) ports', () => {
        const app = new FlowApp();
        const h = new FileStreamHandler({ name: 'h', context: app.context, directory: '/tmp' });
        expect(h.in.direction).toBe('in');
        expect(h.out.direction).toBe('out');
    });

    it('emits a 400 when no filename is given', async () => {
        const app = new FlowApp();
        const h = new FileStreamHandler({ name: 'h', context: app.context, directory: '/tmp' });

        const req: ParsedHttpRequest = {
            requestId: 'r1',
            method: 'GET',
            url: '/',
            pathname: '/',
            searchParams: new URLSearchParams(),
            headers: {},
        };
        h.in.put(req);
        h.step();

        await new Promise(r => setTimeout(r, 20)); // wait for async _handle

        const resp = h.out.read()!;
        expect(resp.requestId).toBe('r1');
        expect(resp.status).toBe(400);
    });

    it('emits a 404 for a non-existent file', async () => {
        const app = new FlowApp();
        const h = new FileStreamHandler({ name: 'h', context: app.context, directory: '/tmp' });

        const req: ParsedHttpRequest = {
            requestId: 'r2',
            method: 'GET',
            url: '/?name=no-such-file-xyz.bin',
            pathname: '/',
            searchParams: new URLSearchParams('name=no-such-file-xyz.bin'),
            headers: {},
        };
        h.in.put(req);
        h.step();
        await new Promise(r => setTimeout(r, 30));

        expect(h.out.read()!.status).toBe(404);
    });

    it('rejects path traversal with 403', async () => {
        const app = new FlowApp();
        const h = new FileStreamHandler({ name: 'h', context: app.context, directory: '/tmp/safe' });

        const req: ParsedHttpRequest = {
            requestId: 'r3',
            method: 'GET',
            url: '/?name=../etc/passwd',
            pathname: '/',
            searchParams: new URLSearchParams('name=../etc/passwd'),
            headers: {},
        };
        h.in.put(req);
        h.step();
        await new Promise(r => setTimeout(r, 30));

        expect(h.out.read()!.status).toBe(403);
    });
});


// ── Integration ───────────────────────────────────────────────────────────────

describe('Binary file streaming (integration)', () => {
    let app: FlowApp;
    let server: HttpServer;
    let dir: string;
    let baseUrl: string;

    beforeEach(async () => {
        dir = join(tmpdir(), `flow-files-${Date.now()}`);
        await mkdir(dir, { recursive: true });

        const port = await freePort();
        baseUrl = `http://127.0.0.1:${port}`;

        app = new FlowApp({ mode: 'push' });
        server = new HttpServer({ name: 'srv', context: app.context, port });
        const dec = new HttpDecoder({ name: 'dec', context: app.context });
        const files = new FileStreamHandler({ name: 'files', context: app.context, directory: dir });

        // server.requests → dec → files → server.streamingResponses
        app
            .addComponent(server)
            .addComponent(dec)
            .addComponent(files)
            .connect(server.requests, dec.requestIn)
            .connect(dec.requestOut, files.in)
            .connect(files.out, server.streamingResponses);

        await app.start();
        app.scheduler.start();
    });

    afterEach(async () => {
        await app.stop();
        await rm(dir, { recursive: true, force: true });
    });

    it('streams a small binary file by ?name= query param', async () => {
        const original = makeBytes(0xdeadbeef, 256);
        await writeFile(join(dir, 'small.bin'), original);

        const res = await fetch(`${baseUrl}/?name=small.bin`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('application/octet-stream');
        expect(Number(res.headers.get('content-length'))).toBe(256);

        const received = new Uint8Array(await res.arrayBuffer());
        expect(received).toEqual(original);
    });

    it('streams a binary file by pathname', async () => {
        const original = makeBytes(0xc0ffee, 512);
        await writeFile(join(dir, 'data.bin'), original);

        const res = await fetch(`${baseUrl}/data.bin`);
        expect(res.status).toBe(200);

        const received = new Uint8Array(await res.arrayBuffer());
        expect(received).toEqual(original);
    });

    it('streams a large binary file (1 MB) without buffering errors', async () => {
        const original = makeBytes(42, 1024 * 1024);
        await writeFile(join(dir, 'large.bin'), original);

        const res = await fetch(`${baseUrl}/?name=large.bin`);
        expect(res.status).toBe(200);
        expect(Number(res.headers.get('content-length'))).toBe(1024 * 1024);

        const received = new Uint8Array(await res.arrayBuffer());
        expect(received.length).toBe(original.length);
        // Spot-check start, middle, and end
        expect(received[0]).toBe(original[0]);
        expect(received[512 * 1024]).toBe(original[512 * 1024]);
        expect(received[received.length - 1]).toBe(original[original.length - 1]);
    });

    it('returns correct MIME types for common extensions', async () => {
        const files: Array<[string, string]> = [
            ['img.png',  'image/png'],
            ['vid.mp4',  'video/mp4'],
            ['doc.pdf',  'application/pdf'],
            ['page.html','text/html; charset=utf-8'],
            ['data.json','application/json'],
        ];

        for (const [name, expectedMime] of files) {
            await writeFile(join(dir, name), new Uint8Array([0]));
            const res = await fetch(`${baseUrl}/?name=${name}`);
            expect(res.status, `${name} should be 200`).toBe(200);
            expect(res.headers.get('content-type'), name).toBe(expectedMime);
            await res.body?.cancel();
        }
    });

    it('returns 404 for an unknown filename', async () => {
        const res = await fetch(`${baseUrl}/?name=nope.bin`);
        expect(res.status).toBe(404);
    });

    it('returns 403 for a path traversal attempt', async () => {
        const res = await fetch(`${baseUrl}/?name=../../../etc/passwd`);
        expect(res.status).toBe(403);
    });

    it('serves concurrent file requests correctly', async () => {
        const files = Array.from({ length: 5 }, (_, i) => ({
            name: `file${i}.bin`,
            data: makeBytes(i * 0x1234, 128 + i * 64),
        }));

        for (const f of files) {
            await writeFile(join(dir, f.name), f.data);
        }

        const responses = await Promise.all(
            files.map(f => fetch(`${baseUrl}/?name=${f.name}`).then(r => r.arrayBuffer())),
        );

        for (let i = 0; i < files.length; i++) {
            expect(new Uint8Array(responses[i])).toEqual(files[i].data);
        }
    });
});
