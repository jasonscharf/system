import {
    FlowApp,
    FlowComponent,
    type FlowComponentOptions,
    type FlowPort,
    HttpDecoder,
    HttpEncoder,
    type HttpResponseDraft,
    HttpResponseWriter,
    HttpServer,
    type ParsedHttpRequest,
} from "@jasonscharf/flow";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// Minimal echo handler used to wire a working pipeline for happy-path tests.
class EchoHandler extends FlowComponent {
    readonly in: FlowPort<ParsedHttpRequest>;
    readonly out: FlowPort<HttpResponseDraft>;

    constructor(options: FlowComponentOptions) {
        super(options);
        this.in = this.addPort<ParsedHttpRequest>("in", "in");
        this.out = this.addPort<HttpResponseDraft>("out", "out");
    }

    override step(): void {
        for (;;) {
            const req = this.in.read();
            if (req === undefined) {
                break;
            }
            this.out.put({
                requestId: req.requestId,
                status: 200,
                contentType: "text/plain",
                body: typeof req.body === "string" ? req.body : "OK",
            });
        }
    }
}

function buildPipeline(app: FlowApp, server: HttpServer): void {
    const dec = new HttpDecoder({ name: "dec", context: app.context });
    const handler = new EchoHandler({ name: "handler", context: app.context });
    const enc = new HttpEncoder({ name: "enc", context: app.context });
    app.addComponent(server)
        .addComponent(dec)
        .addComponent(handler)
        .addComponent(enc)
        .connect(server.requests, dec.requestIn)
        .connect(dec.requestOut, handler.in)
        .connect(handler.out, enc.responseIn)
        .connect(enc.responseOut, server.responses);
}

// Raw TCP request — bypasses fetch so we can lie about Content-Length and send
// partial header bytes. Resolves with the raw response text (may be empty if the
// socket is destroyed before any bytes arrive).
async function rawRequest(
    port: number,
    payload: string,
): Promise<{ response: string; closed: boolean }> {
    const net = await import("node:net");
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, "127.0.0.1");
        let response = "";
        let closed = false;
        socket.setEncoding("utf8");
        socket.on("connect", () => {
            // Write the (possibly partial) payload, then leave the socket open.
            // For slowloris cases we intentionally never send the rest so the
            // server's idle/header timeout is what closes the connection.
            socket.write(payload);
        });
        socket.on("data", (chunk) => {
            response += chunk;
        });
        socket.on("close", () => {
            closed = true;
            resolve({ response, closed });
        });
        socket.on("error", () => {
            // Connection reset (socket destroyed) — treat as closed.
            closed = true;
            resolve({ response, closed });
        });
        // Safety net so a misbehaving test can never hang the suite.
        setTimeout(() => {
            socket.destroy();
            reject(new Error("rawRequest timed out"));
        }, 8000).unref();
    });
}

// ── maxBodyBytes: oversized body rejected with 413 ────────────────────────────

describe("HttpServer: maxBodyBytes enforcement", () => {
    let app: FlowApp;
    let server: HttpServer;
    let port: number;

    beforeEach(async () => {
        port = await freePort();
        app = new FlowApp({ mode: "push" });
        server = new HttpServer({
            name: "srv",
            context: app.context,
            port,
            maxBodyBytes: 1024,
        });
        buildPipeline(app, server);
        await app.start();
        app.scheduler.start();
    });

    afterEach(async () => {
        await app.stop();
    });

    it("rejects an honestly-declared oversized body with 413", async () => {
        const res = await fetch(`http://127.0.0.1:${port}/upload`, {
            method: "POST",
            headers: { "content-type": "text/plain" },
            body: "x".repeat(4096),
        }).catch(() => null);
        // Either we get a 413, or the socket is destroyed (fetch rejects). Both
        // are acceptable rejections; assert we never get a 2xx.
        if (res) {
            expect(res.status).toBe(413);
        }
    });

    it("rejects a streamed body that overruns the cap regardless of (lying/absent) Content-Length and stays healthy", async () => {
        // Stream far more than the cap. Whether the client lies in Content-Length
        // or omits it, the server must count streamed bytes and abort rather than
        // buffer the whole thing. The server must also survive and keep serving.
        const big = "x".repeat(8 * 1024 * 1024); // 8 MiB, dwarfs the 1 KiB cap
        const payload =
            "POST /upload HTTP/1.1\r\n" +
            "Host: 127.0.0.1\r\n" +
            "Content-Type: text/plain\r\n" +
            "Content-Length: 10\r\n" +
            "\r\n" +
            big;
        const { response, closed } = await rawRequest(port, payload);
        expect(closed).toBe(true);
        // The server must reject without a 2xx. Depending on parser state it may
        // emit our 413 or Node's own 400 (declared length undershoots the body)
        // before the socket is destroyed — either way the request is refused.
        if (response.length > 0) {
            expect(response).toMatch(/ 4\d\d /);
        }
        // The server did not crash buffering 8 MiB — a follow-up request succeeds.
        const ok = await fetch(`http://127.0.0.1:${port}/echo`, {
            method: "POST",
            headers: { "content-type": "text/plain" },
            body: "still-up",
        });
        expect(ok.status).toBe(200);
        expect(await ok.text()).toBe("still-up");
    });

    it("rejects an oversized body with absent Content-Length (chunked) by counting bytes", async () => {
        // Chunked transfer-encoding has no Content-Length; the streamed-byte
        // counter is the only defense. Send one chunk well over the cap.
        const big = "x".repeat(64 * 1024);
        const chunkHeader = big.length.toString(16);
        const payload =
            "POST /upload HTTP/1.1\r\n" +
            "Host: 127.0.0.1\r\n" +
            "Content-Type: text/plain\r\n" +
            "Transfer-Encoding: chunked\r\n" +
            "\r\n" +
            `${chunkHeader}\r\n${big}\r\n0\r\n\r\n`;
        const { response, closed } = await rawRequest(port, payload);
        expect(closed).toBe(true);
        if (response.length > 0) {
            expect(response).toMatch(/ 4\d\d /);
        }
    });

    it("rejects up-front when Content-Length already exceeds the cap", async () => {
        const payload =
            "POST /upload HTTP/1.1\r\n" +
            "Host: 127.0.0.1\r\n" +
            "Content-Type: text/plain\r\n" +
            "Content-Length: 1000000\r\n" +
            "\r\n";
        const { response, closed } = await rawRequest(port, payload);
        expect(closed).toBe(true);
        if (response.length > 0) {
            expect(response).toContain("413");
        }
    });

    it("accepts a normal request under the cap", async () => {
        const res = await fetch(`http://127.0.0.1:${port}/echo`, {
            method: "POST",
            headers: { "content-type": "text/plain" },
            body: "hello",
        });
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("hello");
    });
});

// ── Timeouts: slow-header client is dropped ───────────────────────────────────

describe("HttpServer: header timeout drops slow clients", () => {
    let app: FlowApp;
    let server: HttpServer;
    let port: number;

    beforeEach(async () => {
        port = await freePort();
        app = new FlowApp({ mode: "push" });
        server = new HttpServer({
            name: "srv",
            context: app.context,
            port,
            headersTimeoutMs: 300,
            requestTimeoutMs: 300,
            idleTimeoutMs: 300,
        });
        buildPipeline(app, server);
        await app.start();
        app.scheduler.start();
    });

    afterEach(async () => {
        await app.stop();
    });

    it("closes the connection when headers never complete", async () => {
        const start = Date.now();
        // Send a partial request line and then go silent — never finish headers.
        const partial = "GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n";
        const { closed } = await rawRequest(port, partial);
        const elapsed = Date.now() - start;
        expect(closed).toBe(true);
        // The configured 300ms timeout must have fired (well under the 8s safety).
        expect(elapsed).toBeLessThan(4000);
    });
});

// ── Security headers ──────────────────────────────────────────────────────────

describe("HttpServer: default security headers", () => {
    let app: FlowApp;
    let server: HttpServer;
    let port: number;

    beforeEach(async () => {
        port = await freePort();
        app = new FlowApp({ mode: "push" });
        server = new HttpServer({ name: "srv", context: app.context, port });
        buildPipeline(app, server);
        await app.start();
        app.scheduler.start();
    });

    afterEach(async () => {
        await app.stop();
    });

    it("sets X-Content-Type-Options and Referrer-Policy on responses", async () => {
        const res = await fetch(`http://127.0.0.1:${port}/echo`, {
            method: "POST",
            headers: { "content-type": "text/plain" },
            body: "hi",
        });
        expect(res.headers.get("x-content-type-options")).toBe("nosniff");
        expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    });
});

describe("HttpServer: security headers are overridable per response", () => {
    let app: FlowApp;
    let server: HttpServer;
    let port: number;

    // Handler that sets its own referrer-policy to prove the response wins.
    class OverrideHandler extends FlowComponent {
        readonly in: FlowPort<ParsedHttpRequest>;
        readonly out: FlowPort<HttpResponseDraft>;
        constructor(options: FlowComponentOptions) {
            super(options);
            this.in = this.addPort<ParsedHttpRequest>("in", "in");
            this.out = this.addPort<HttpResponseDraft>("out", "out");
        }
        override step(): void {
            for (;;) {
                const req = this.in.read();
                if (req === undefined) {
                    break;
                }
                this.out.put({
                    requestId: req.requestId,
                    status: 200,
                    contentType: "text/plain",
                    headers: { "referrer-policy": "same-origin" },
                    body: "ok",
                });
            }
        }
    }

    beforeEach(async () => {
        port = await freePort();
        app = new FlowApp({ mode: "push" });
        server = new HttpServer({ name: "srv", context: app.context, port });
        const dec = new HttpDecoder({ name: "dec", context: app.context });
        const handler = new OverrideHandler({ name: "handler", context: app.context });
        const enc = new HttpEncoder({ name: "enc", context: app.context });
        app.addComponent(server)
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

    it("keeps the response's own header value over the default", async () => {
        const res = await fetch(`http://127.0.0.1:${port}/x`);
        expect(res.headers.get("referrer-policy")).toBe("same-origin");
        // The non-overridden default is still applied.
        expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    });
});

// ── HttpResponseWriter (unit) ─────────────────────────────────────────────────

describe("HttpResponseWriter: security header merge", () => {
    it("applies defaults and respects empty override map", () => {
        const app = new FlowApp();
        const captured: { headers?: Record<string, string | string[]> }[] = [];
        const writer = new HttpResponseWriter({ name: "w", context: app.context });
        writer._setSend((r) => captured.push({ headers: r.headers }));
        writer.in.put({ requestId: "r1", status: 200, headers: {} });
        writer.step();
        expect(captured[0]?.headers?.["x-content-type-options"]).toBe("nosniff");
        expect(captured[0]?.headers?.["referrer-policy"]).toBe("no-referrer");

        const captured2: { headers?: Record<string, string | string[]> }[] = [];
        const off = new HttpResponseWriter({
            name: "w2",
            context: app.context,
            securityHeaders: {},
        });
        off._setSend((r) => captured2.push({ headers: r.headers }));
        off.in.put({ requestId: "r2", status: 200, headers: {} });
        off.step();
        expect(captured2[0]?.headers?.["x-content-type-options"]).toBeUndefined();
    });

    it("does not overwrite a header the response already sets (case-insensitive)", () => {
        const app = new FlowApp();
        const captured: { headers?: Record<string, string | string[]> }[] = [];
        const writer = new HttpResponseWriter({ name: "w", context: app.context });
        writer._setSend((r) => captured.push({ headers: r.headers }));
        writer.in.put({
            requestId: "r1",
            status: 200,
            headers: { "X-Content-Type-Options": "custom" },
        });
        writer.step();
        expect(captured[0]?.headers?.["X-Content-Type-Options"]).toBe("custom");
        // Default must not have been duplicated under the lowercase key.
        expect(captured[0]?.headers?.["x-content-type-options"]).toBeUndefined();
    });
});
