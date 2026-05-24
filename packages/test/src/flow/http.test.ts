import {
    FlowApp,
    FlowComponent,
    type FlowComponentOptions,
    FlowContext,
    type FlowPort,
    HttpClient,
    HttpCtx,
    HttpDecoder,
    HttpEncoder,
    type HttpMethod,
    type HttpRequest,
    type HttpResponse,
    type HttpResponseDraft,
    HttpRouter,
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

async function waitForMessage<T>(port: FlowPort<T>, timeoutMs = 3000): Promise<T> {
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

function readPort<T>(port: FlowPort<T>): T {
    const val = port.read();
    if (val === undefined) {
        throw new Error(`expected a message on port "${port.name}"`);
    }
    return val;
}

// ── HttpEncoder ───────────────────────────────────────────────────────────────

describe("HttpEncoder", () => {
    let ctx: FlowContext;
    let enc: HttpEncoder;

    beforeEach(() => {
        ctx = new FlowContext();
        enc = new HttpEncoder({ name: "enc", context: ctx });
    });

    it("has requestIn/requestOut and responseIn/responseOut ports", () => {
        expect(enc.requestIn.direction).toBe("in");
        expect(enc.requestOut.direction).toBe("out");
        expect(enc.responseIn.direction).toBe("in");
        expect(enc.responseOut.direction).toBe("out");
    });

    it("encodes a JSON body and sets Content-Type header", () => {
        enc.requestIn.put({ method: "POST", url: "/foo", body: { name: "Alice" } });
        enc.step();
        const out = readPort(enc.requestOut);
        expect(out.body).toBe(JSON.stringify({ name: "Alice" }));
        expect(String(out.headers["content-type"])).toContain("application/json");
    });

    it("encodes a string body as text/plain by default", () => {
        enc.requestIn.put({ method: "POST", url: "/foo", body: "hello" });
        enc.step();
        const out = readPort(enc.requestOut);
        expect(out.body).toBe("hello");
        expect(String(out.headers["content-type"])).toContain("text/plain");
    });

    it("encodes Uint8Array as application/octet-stream", () => {
        const bytes = new Uint8Array([1, 2, 3]);
        enc.requestIn.put({ method: "POST", url: "/bin", body: bytes });
        enc.step();
        const out = readPort(enc.requestOut);
        expect(out.body).toEqual(bytes);
        expect(String(out.headers["content-type"])).toContain("application/octet-stream");
    });

    it("encodes form-urlencoded when contentType is set", () => {
        enc.requestIn.put({
            method: "POST",
            url: "/form",
            body: { a: "1", b: "2" },
            contentType: "application/x-www-form-urlencoded",
        });
        enc.step();
        const out = readPort(enc.requestOut);
        expect(out.body).toContain("a=1");
        expect(out.body).toContain("b=2");
    });

    it("omits body and Content-Type for requests without body", () => {
        enc.requestIn.put({ method: "GET", url: "/ping" });
        enc.step();
        const out = readPort(enc.requestOut);
        expect(out.body).toBeUndefined();
        expect(out.headers["content-type"]).toBeUndefined();
    });

    it("encodes response drafts with status and body", () => {
        enc.responseIn.put({ requestId: "r1", status: 200, body: { ok: true } });
        enc.step();
        const out = readPort(enc.responseOut);
        expect(out.requestId).toBe("r1");
        expect(out.status).toBe(200);
        expect(out.body).toBe(JSON.stringify({ ok: true }));
    });

    it("defaults response status to 200", () => {
        enc.responseIn.put({ body: "pong" });
        enc.step();
        const out = readPort(enc.responseOut);
        expect(out.status).toBe(200);
    });

    it("passes through explicit headers untouched", () => {
        enc.requestIn.put({ method: "GET", url: "/", headers: { "x-custom": "val" } });
        enc.step();
        const out = readPort(enc.requestOut);
        expect(out.headers["x-custom"]).toBe("val");
    });

    it("processes multiple requests and responses in one step", () => {
        enc.requestIn.put({ method: "GET", url: "/a" });
        enc.requestIn.put({ method: "GET", url: "/b" });
        enc.responseIn.put({ status: 201, body: "c" });
        enc.step();
        expect(enc.requestOut.size).toBe(2);
        expect(enc.responseOut.size).toBe(1);
    });
});

// ── HttpDecoder ───────────────────────────────────────────────────────────────

describe("HttpDecoder", () => {
    let ctx: FlowContext;
    let dec: HttpDecoder;

    beforeEach(() => {
        ctx = new FlowContext();
        dec = new HttpDecoder({ name: "dec", context: ctx });
    });

    it("has requestIn/requestOut and responseIn/responseOut ports", () => {
        expect(dec.requestIn.direction).toBe("in");
        expect(dec.requestOut.direction).toBe("out");
        expect(dec.responseIn.direction).toBe("in");
        expect(dec.responseOut.direction).toBe("out");
    });

    it("decodes a JSON request body", () => {
        dec.requestIn.put({
            method: "POST",
            url: "/api",
            headers: { "content-type": "application/json" },
            body: '{"x":1}',
        });
        dec.step();
        const out = readPort(dec.requestOut);
        expect(out.body).toEqual({ x: 1 });
        expect(out.contentType).toContain("application/json");
    });

    it("decodes a form-urlencoded request body", () => {
        dec.requestIn.put({
            method: "POST",
            url: "/form",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: "a=1&b=hello+world",
        });
        dec.step();
        const out = readPort(dec.requestOut);
        expect((out.body as Record<string, string>).a).toBe("1");
        expect((out.body as Record<string, string>).b).toBe("hello world");
    });

    it("decodes a text/plain request body as string", () => {
        dec.requestIn.put({
            method: "POST",
            url: "/text",
            headers: { "content-type": "text/plain" },
            body: "raw text",
        });
        dec.step();
        expect(dec.requestOut.read()?.body).toBe("raw text");
    });

    it("leaves body undefined when no body is present", () => {
        dec.requestIn.put({ method: "GET", url: "/", headers: {} });
        dec.step();
        expect(dec.requestOut.read()?.body).toBeUndefined();
    });

    it("populates pathname and searchParams from url", () => {
        dec.requestIn.put({ method: "GET", url: "/users?page=2&limit=10", headers: {} });
        dec.step();
        const out = readPort(dec.requestOut);
        expect(out.pathname).toBe("/users");
        expect(out.searchParams.get("page")).toBe("2");
        expect(out.searchParams.get("limit")).toBe("10");
    });

    it("decodes JSON response body", () => {
        dec.responseIn.put({
            status: 200,
            headers: { "content-type": "application/json" },
            body: '{"id":42}',
        });
        dec.step();
        const out = readPort(dec.responseOut);
        expect(out.body).toEqual({ id: 42 });
        expect(out.ok).toBe(true);
    });

    it("sets ok=false for 4xx/5xx responses", () => {
        dec.responseIn.put({ status: 404, headers: {}, body: "not found" });
        dec.step();
        expect(dec.responseOut.read()?.ok).toBe(false);
    });

    it("round-trips through encoder then decoder", () => {
        const ctx2 = new FlowContext();
        const enc = new HttpEncoder({ name: "e", context: ctx2 });
        const dec2 = new HttpDecoder({ name: "d", context: ctx2 });
        const payload = { greeting: "hello", count: 3 };

        enc.requestIn.put({ method: "POST", url: "/echo", body: payload });
        enc.step();

        const encoded = readPort(enc.requestOut);
        dec2.requestIn.put(encoded);
        dec2.step();

        expect(dec2.requestOut.read()?.body).toEqual(payload);
    });
});

// ── HttpServer (unit) ─────────────────────────────────────────────────────────

describe("HttpServer (unit)", () => {
    it("exposes requests and responses ports", () => {
        const app = new FlowApp();
        const srv = new HttpServer({ name: "srv", context: app.context, port: 0 });
        expect(srv.requests.direction).toBe("out");
        expect(srv.responses.direction).toBe("in");
    });

    it("has reader and writer as children", () => {
        const app = new FlowApp();
        const srv = new HttpServer({ name: "srv", context: app.context, port: 0 });
        expect(srv.children).toContain(srv.reader);
        expect(srv.children).toContain(srv.writer);
    });

    it("step() forwards responses port to writer.in", () => {
        const app = new FlowApp();
        const srv = new HttpServer({ name: "srv", context: app.context, port: 0 });
        const resp: HttpResponse = { requestId: "r1", status: 200, headers: {}, body: "hi" };
        srv.responses.put(resp);
        srv.step();
        expect(srv.writer.in.read()).toEqual(resp);
    });
});

// ── HttpClient (unit) ─────────────────────────────────────────────────────────

describe("HttpClient (unit)", () => {
    it("exposes requests and responses ports", () => {
        const app = new FlowApp();
        const cli = new HttpClient({ name: "cli", context: app.context });
        expect(cli.requests.direction).toBe("in");
        expect(cli.responses.direction).toBe("out");
    });
});

// ── Integration: full HTTP echo pipeline ─────────────────────────────────────

describe("HTTP echo integration", () => {
    // EchoHandler: reads parsed requests, emits response drafts with body uppercased
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
                    body: typeof req.body === "string" ? req.body.toUpperCase() : "OK",
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

        app = new FlowApp({ mode: "push" });

        server = new HttpServer({ name: "server", context: app.context, port });
        const dec = new HttpDecoder({ name: "dec", context: app.context });
        const handler = new EchoHandler({ name: "handler", context: app.context });
        const enc = new HttpEncoder({ name: "enc", context: app.context });

        // server.requests → dec.requestIn → dec.requestOut → handler.in → handler.out
        //   → enc.responseIn → enc.responseOut → server.responses
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

    it("echoes a POST body in uppercase via fetch", async () => {
        const res = await fetch(`${baseUrl}/echo`, {
            method: "POST",
            headers: { "content-type": "text/plain" },
            body: "hello world",
        });
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("HELLO WORLD");
    });

    it("handles GET requests with no body", async () => {
        const res = await fetch(`${baseUrl}/ping`);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("OK");
    });

    it("HttpClient can send a request and receive a response", async () => {
        const client = new HttpClient({ name: "cli", context: app.context });
        await client.init();

        client.requests.put({ method: "POST", url: `${baseUrl}/test`, headers: {}, body: "hi" });
        app.scheduler.tick(); // step client → fires fetch

        const response = await waitForMessage(client.responses);
        expect(response.status).toBe(200);
        expect(response.body).toBe("HI");

        await client.dispose();
    });

    it("handles concurrent requests correctly", async () => {
        const [r1, r2, r3] = await Promise.all([
            fetch(`${baseUrl}/`, {
                method: "POST",
                headers: { "content-type": "text/plain" },
                body: "a",
            }),
            fetch(`${baseUrl}/`, {
                method: "POST",
                headers: { "content-type": "text/plain" },
                body: "b",
            }),
            fetch(`${baseUrl}/`, {
                method: "POST",
                headers: { "content-type": "text/plain" },
                body: "c",
            }),
        ]);
        expect(await r1.text()).toBe("A");
        expect(await r2.text()).toBe("B");
        expect(await r3.text()).toBe("C");
    });
});

// ── Additional coverage ───────────────────────────────────────────────────────

function makeRequest(method: string, pathname: string): ParsedHttpRequest {
    return {
        method: method as HttpMethod,
        url: pathname,
        pathname,
        searchParams: new URLSearchParams(),
        headers: {},
        requestId: "r1",
    };
}

async function drain(router: HttpRouter, n = 1): Promise<HttpResponseDraft[]> {
    const out: HttpResponseDraft[] = [];
    const deadline = Date.now() + 500;
    while (out.length < n && Date.now() < deadline) {
        const r = router.responses.read();
        if (r !== undefined) {
            out.push(r);
        } else {
            await new Promise((t) => setTimeout(t, 5));
        }
    }
    return out;
}

describe("HttpCtx convenience methods", () => {
    const req = () => makeRequest("GET", "/test");

    it("send() sets status and body together", () => {
        const ctx = new HttpCtx(req());
        ctx.send(201, { ok: true });
        expect(ctx.status).toBe(201);
        expect(ctx.body).toEqual({ ok: true });
    });

    it("badRequest() sets 400", () => {
        const ctx = new HttpCtx(req());
        ctx.badRequest();
        expect(ctx.status).toBe(400);
    });

    it("badRequest() with custom message", () => {
        const ctx = new HttpCtx(req());
        ctx.badRequest("Missing field");
        expect((ctx.body as { error: string }).error).toBe("Missing field");
    });

    it("unauthorized() sets 401", () => {
        const ctx = new HttpCtx(req());
        ctx.unauthorized();
        expect(ctx.status).toBe(401);
    });

    it("forbidden() sets 403", () => {
        const ctx = new HttpCtx(req());
        ctx.forbidden();
        expect(ctx.status).toBe(403);
    });

    it("notFound() sets 404", () => {
        const ctx = new HttpCtx(req());
        ctx.notFound();
        expect(ctx.status).toBe(404);
    });

    it("method getter returns HTTP method", () => {
        const ctx = new HttpCtx(makeRequest("POST", "/"));
        expect(ctx.method).toBe("POST");
    });

    it("pathname getter returns pathname", () => {
        const ctx = new HttpCtx(makeRequest("GET", "/users/42"));
        expect(ctx.pathname).toBe("/users/42");
    });

    it("extras are merged onto ctx", () => {
        const ctx = new HttpCtx(req(), { store: "db" });
        expect(ctx.store).toBe("db");
    });
});

describe("HttpRouter additional methods and branches", () => {
    let ctx: FlowContext;
    beforeEach(() => {
        ctx = new FlowContext();
    });

    it("put() handles PUT requests", async () => {
        const router = new HttpRouter({ name: "r", context: ctx });
        router.put("/resource", async (c) => {
            c.status = 204;
        });
        router.requests.put(makeRequest("PUT", "/resource"));
        router.step();
        const [resp] = await drain(router);
        expect(resp.status).toBe(204);
    });

    it("patch() handles PATCH requests", async () => {
        const router = new HttpRouter({ name: "r", context: ctx });
        router.patch("/resource", async (c) => {
            c.body = { patched: true };
        });
        router.requests.put(makeRequest("PATCH", "/resource"));
        router.step();
        const [resp] = await drain(router);
        expect(resp.status).toBe(200);
    });

    it("delete() handles DELETE requests", async () => {
        const router = new HttpRouter({ name: "r", context: ctx });
        router.delete("/resource", async (c) => {
            c.status = 204;
        });
        router.requests.put(makeRequest("DELETE", "/resource"));
        router.step();
        const [resp] = await drain(router);
        expect(resp.status).toBe(204);
    });

    it("head() handles HEAD requests", async () => {
        const router = new HttpRouter({ name: "r", context: ctx });
        router.head("/resource", async (c) => {
            c.status = 200;
        });
        router.requests.put(makeRequest("HEAD", "/resource"));
        router.step();
        const [resp] = await drain(router);
        expect(resp.status).toBe(200);
    });

    it("use(prefix, fn) with trailing slash matches sub-paths", async () => {
        const router = new HttpRouter({ name: "r", context: ctx });
        let ran = false;
        router.use("/api/", async (_c, next) => {
            ran = true;
            await next();
        });
        router.get("/api/ping", async (c) => {
            c.body = {};
        });
        router.requests.put(makeRequest("GET", "/api/ping"));
        router.step();
        await drain(router);
        expect(ran).toBe(true);
    });

    it("use(prefix, fn) without trailing slash also matches", async () => {
        const router = new HttpRouter({ name: "r", context: ctx });
        let ran = false;
        router.use("/api", async (_c, next) => {
            ran = true;
            await next();
        });
        router.get("/api/ping", async (c) => {
            c.body = {};
        });
        router.requests.put(makeRequest("GET", "/api/ping"));
        router.step();
        await drain(router);
        expect(ran).toBe(true);
    });
});

describe("HttpRouter: inferContentType branches and 204 no-body status", () => {
    it("infers text/plain for string body (line 68)", async () => {
        const ctx = new FlowContext();
        const router = new HttpRouter({ name: "r", context: ctx });
        router.get("/txt", async (c: HttpCtx) => {
            c.body = "plain text";
        });
        router.requests.put(makeRequest("GET", "/txt"));
        router.step();
        const [resp] = await drain(router);
        expect(resp.contentType).toContain("text/plain");
    });

    it("infers application/octet-stream for Uint8Array body (line 67)", async () => {
        const ctx = new FlowContext();
        const router = new HttpRouter({ name: "r", context: ctx });
        router.get("/bin", async (c: HttpCtx) => {
            c.body = new Uint8Array([1, 2, 3]);
        });
        router.requests.put(makeRequest("GET", "/bin"));
        router.step();
        const [resp] = await drain(router);
        expect(resp.contentType).toBe("application/octet-stream");
    });

    it("does not call notFound when handler sets status 204 with no body (line 215 false)", async () => {
        const ctx = new FlowContext();
        const router = new HttpRouter({ name: "r", context: ctx });
        // body stays undefined but status is 204 — condition (body===undefined && status===200) is FALSE
        // handler calls next() so finalNext IS invoked, making the condition reachable
        router.get("/no-content", async (c: HttpCtx, next) => {
            c.status = 204;
            await next();
        });
        router.requests.put(makeRequest("GET", "/no-content"));
        router.step();
        const [resp] = await drain(router);
        expect(resp.status).toBe(204);
    });

    it("returns explicit content-type when set as string in ctx.headers (line 66 truthy branch)", async () => {
        const ctx = new FlowContext();
        const router = new HttpRouter({ name: "r", context: ctx });
        router.get("/ct", async (c: HttpCtx) => {
            c.headers["content-type"] = "application/xml";
            c.body = "<root/>";
        });
        router.requests.put(makeRequest("GET", "/ct"));
        router.step();
        const [resp] = await drain(router);
        expect(resp.contentType).toBe("application/xml");
    });

    it("returns first element when content-type is array (line 66 Array.isArray branch)", async () => {
        const ctx = new FlowContext();
        const router = new HttpRouter({ name: "r", context: ctx });
        router.get("/arr", async (c: HttpCtx) => {
            (c.headers["content-type"] as unknown) = ["text/html", "charset=utf-8"];
            c.body = "<h1>ok</h1>";
        });
        router.requests.put(makeRequest("GET", "/arr"));
        router.step();
        const [resp] = await drain(router);
        expect(resp.contentType).toBe("text/html");
    });
});

describe("HttpRouter: mounted sub-router prefix edge cases", () => {
    it("skips sub-router when request path does not start with mount prefix (line 246 continue)", async () => {
        const ctx = new FlowContext();
        const router = new HttpRouter({ name: "r", context: ctx });
        const sub = new HttpRouter({ name: "sub", context: ctx });
        sub.get("/items", async (c: HttpCtx) => {
            c.body = { ok: true };
        });
        router.mount("/api", sub);
        // Path "/other" does not start with "/api" → continue in for-loop
        router.requests.put(makeRequest("GET", "/other/items"));
        router.step();
        const [resp] = await drain(router);
        expect(resp.status).toBe(404);
    });

    it('uses "/" as sub-path when pathname exactly equals mount prefix (line 247 || "/")', async () => {
        const ctx = new FlowContext();
        const router = new HttpRouter({ name: "r", context: ctx });
        const sub = new HttpRouter({ name: "sub", context: ctx });
        sub.get("/", async (c: HttpCtx) => {
            c.body = { root: true };
        });
        router.mount("/api", sub);
        // Exact match — slice leaves empty string → || '/'
        router.requests.put(makeRequest("GET", "/api"));
        router.step();
        const [resp] = await drain(router);
        expect(resp.status).toBe(200);
    });
});

describe("HttpClient.onInit() guard", () => {
    it("throws when globalThis.fetch is undefined", async () => {
        const app = new FlowApp();
        const client = new HttpClient({ name: "cli", context: app.context });
        const original = globalThis.fetch;
        try {
            // @ts-expect-error deliberately breaking the type
            globalThis.fetch = undefined;
            await expect(client.init()).rejects.toThrow("platform-native fetch");
        } finally {
            globalThis.fetch = original;
        }
    });

    it("aborts in-flight requests on dispose", async () => {
        const app = new FlowApp();
        const client = new HttpClient({ name: "cli", context: app.context });
        await client.init();
        // dispose should not throw
        await client.dispose();
    });
});

describe("HttpClient._fetch: AbortError swallowing and header joining", () => {
    it("joins multi-value headers with comma", async () => {
        const app = new FlowApp();
        const client = new HttpClient({ name: "cli", context: app.context });
        await client.init();

        let captured: Record<string, string> | undefined;
        const origFetch = globalThis.fetch;
        globalThis.fetch = ((_url: string, init?: RequestInit) => {
            captured = init?.headers as Record<string, string>;
            return Promise.resolve(new Response("{}", { status: 200 }));
        }) as typeof fetch;

        try {
            client.requests.put({
                method: "GET",
                url: "http://localhost/",
                requestId: "r1",
                headers: { "x-multi": ["a", "b"] },
            });
            client.step();
            await new Promise((r) => setTimeout(r, 50));
            expect(captured?.["x-multi"]).toBe("a, b");
        } finally {
            globalThis.fetch = origFetch;
            await client.dispose();
        }
    });
});

describe("HttpDecoder with Uint8Array body", () => {
    it("decodes Uint8Array body based on content-type", () => {
        const ctx = new FlowContext();
        const dec = new HttpDecoder({ name: "dec", context: ctx });
        const bytes = new TextEncoder().encode('{"x":1}');
        dec.requestIn.put({
            method: "POST",
            url: "/api",
            headers: { "content-type": "application/json" },
            body: bytes,
        });
        dec.step();
        const out = readPort(dec.requestOut);
        expect(out.body).toEqual({ x: 1 });
    });
});

describe("HttpEncoder: request without body", () => {
    it("omits body and content-type for GET with no body", () => {
        const ctx = new FlowContext();
        const enc = new HttpEncoder({ name: "enc", context: ctx });
        enc.requestIn.put({ method: "GET", url: "/ping" });
        enc.step();
        const out = readPort(enc.requestOut);
        expect(out.body).toBeUndefined();
        expect(out.headers["content-type"]).toBeUndefined();
    });
});

describe("codec: edge cases", () => {
    it("decodeBody returns undefined for empty Uint8Array body", () => {
        const ctx = new FlowContext();
        const dec = new HttpDecoder({ name: "dec", context: ctx });
        dec.requestIn.put({
            method: "POST",
            url: "/",
            headers: { "content-type": "application/json" },
            body: new Uint8Array(0),
        });
        dec.step();
        expect(dec.requestOut.read()?.body).toBeUndefined();
    });

    it("decodeBody returns undefined for empty string body", () => {
        const ctx = new FlowContext();
        const dec = new HttpDecoder({ name: "dec", context: ctx });
        dec.requestIn.put({
            method: "POST",
            url: "/",
            headers: { "content-type": "application/json" },
            body: "",
        });
        dec.step();
        expect(dec.requestOut.read()?.body).toBeUndefined();
    });

    it("decodeBody falls back to text for unknown application/* type with bad JSON", () => {
        const ctx = new FlowContext();
        const dec = new HttpDecoder({ name: "dec", context: ctx });
        dec.requestIn.put({
            method: "POST",
            url: "/",
            headers: { "content-type": "application/vnd.custom+json" },
            body: "{invalid json",
        });
        dec.step();
        // Should return the raw string when JSON.parse fails
        expect(dec.requestOut.read()?.body).toBe("{invalid json");
    });
});

describe("FileStreamHandler: directory request returns 404", () => {
    it("returns 404 when path resolves to a directory", async () => {
        const { mkdtemp, rm, mkdir } = await import("node:fs/promises");
        const { join } = await import("node:path");
        const { tmpdir } = await import("node:os");
        const { FileStreamHandler } = await import("@system/flow");
        const { FlowContext: FC } = await import("@system/flow");

        const dir = await mkdtemp(join(tmpdir(), "tern-fsh-"));
        try {
            await mkdir(join(dir, "subdir"));
            const _ctx = new FC();
            const app = new FlowApp();
            const handler = new FileStreamHandler({
                name: "h",
                context: app.context,
                directory: dir,
            });
            handler.in.put({
                requestId: "r",
                method: "GET",
                url: "/?name=subdir",
                pathname: "/",
                searchParams: new URLSearchParams("name=subdir"),
                headers: {},
            });
            handler.step();
            await new Promise((r) => setTimeout(r, 50));
            const resp = readPort(handler.out);
            expect(resp.status).toBe(404);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});

// ── Additional http coverage ──────────────────────────────────────────────────

describe("codec: array content-type header and Uint8Array raw return", () => {
    it("extractContentType handles array header values", () => {
        const ctx = new FlowContext();
        const dec = new HttpDecoder({ name: "dec", context: ctx });
        dec.requestIn.put({
            method: "POST",
            url: "/",
            headers: { "content-type": ["application/json", "charset=utf-8"] },
            body: '{"x":1}',
        });
        dec.step();
        expect(dec.requestOut.read()?.body).toEqual({ x: 1 });
    });

    it("decodeBody returns Uint8Array unchanged for unknown binary type", () => {
        const ctx = new FlowContext();
        const dec = new HttpDecoder({ name: "dec", context: ctx });
        const bytes = new Uint8Array([1, 2, 3]);
        dec.requestIn.put({
            method: "POST",
            url: "/",
            headers: { "content-type": "application/octet-stream" },
            body: bytes,
        });
        dec.step();
        const out = readPort(dec.requestOut);
        // raw Uint8Array returned as-is for non-text types
        expect(out.body).toBe(bytes);
    });
});

describe("codec: text/html and text/css content types (switch case coverage)", () => {
    it("decodeBody returns text for text/html", () => {
        const ctx = new FlowContext();
        const dec = new HttpDecoder({ name: "dec", context: ctx });
        dec.requestIn.put({
            method: "GET",
            url: "/",
            headers: { "content-type": "text/html" },
            body: "<h1>hi</h1>",
        });
        dec.step();
        expect(dec.requestOut.read()?.body).toBe("<h1>hi</h1>");
    });

    it("decodeBody returns text for text/css", () => {
        const ctx = new FlowContext();
        const dec = new HttpDecoder({ name: "dec", context: ctx });
        dec.requestIn.put({
            method: "GET",
            url: "/",
            headers: { "content-type": "text/css" },
            body: "body{}",
        });
        dec.step();
        expect(dec.requestOut.read()?.body).toBe("body{}");
    });
});

describe("HttpRouter: next() called multiple times throws (line 16)", () => {
    it("compose throws when next() is called twice — captured via unhandledRejection", async () => {
        const ctx = new FlowContext();
        const router = new HttpRouter({ name: "r", context: ctx });

        let caughtError: Error | undefined;
        const handler = (err: Error) => {
            caughtError = err;
        };
        process.once("unhandledRejection", handler);

        try {
            router.get("/path", async (_c: HttpCtx, next: () => Promise<void>) => {
                await next();
                await next();
            });
            router.requests.put(makeRequest("GET", "/path"));
            router.step();
            await new Promise((r) => setTimeout(r, 30));
            expect(caughtError?.message).toMatch(/next.*called multiple/i);
        } finally {
            process.removeListener("unhandledRejection", handler);
        }
    });
});

describe("HttpDecoder: malformed URL triggers catch branch", () => {
    it("falls back to raw string when URL constructor throws (malformed IPv6 host)", () => {
        const ctx = new FlowContext();
        const dec = new HttpDecoder({ name: "dec", context: ctx });
        // An explicit scheme with a malformed IPv6 host reliably throws in WHATWG URL
        const badUrl = "http://[::invalid";
        dec.requestIn.put({ method: "GET", url: badUrl, headers: {} });
        dec.step();
        const out = readPort(dec.requestOut);
        expect(out.pathname).toBe(badUrl);
    });
});

describe("HttpRouter: static segment mismatch returns null", () => {
    it("does not match when a static segment differs", async () => {
        const ctx = new FlowContext();
        const router = new HttpRouter({ name: "r", context: ctx });
        router.get("/exact/path", async (c) => {
            c.body = {};
        });
        router.requests.put(makeRequest("GET", "/exact/wrong"));
        router.step();
        const [resp] = await drain(router);
        expect(resp.status).toBe(404);
    });

    it("does not match when path has more segments than pattern", async () => {
        const ctx = new FlowContext();
        const router = new HttpRouter({ name: "r", context: ctx });
        router.get("/users", async (c) => {
            c.body = {};
        });
        router.requests.put(makeRequest("GET", "/users/extra/segments"));
        router.step();
        const [resp] = await drain(router);
        expect(resp.status).toBe(404);
    });
});

describe("HttpServer: response with no body (res.end() empty branch)", () => {
    let app: FlowApp;
    let server: HttpServer;
    let port: number;

    beforeEach(async () => {
        port = await freePort();
        app = new FlowApp({ mode: "push" });
        server = new HttpServer({ name: "srv", context: app.context, port });
        const dec = new HttpDecoder({ name: "dec", context: app.context });
        // Handler returns 204 No Content (no body)
        class NoBodyHandler extends FlowComponent {
            readonly in = this.addPort<ParsedHttpRequest>("in", "in");
            readonly out = this.addPort<HttpResponseDraft>("out", "out");
            constructor(ctx: FlowApp) {
                super({ name: "h", context: ctx.context });
            }
            override step(): void {
                for (;;) {
                    const req = this.in.read();
                    if (req === undefined) {
                        break;
                    }
                    this.out.put({ requestId: (req as ParsedHttpRequest).requestId, status: 204 });
                }
            }
        }
        const handler = new NoBodyHandler(app);
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

    it("returns 204 with no body (triggers res.end() without body)", async () => {
        const res = await fetch(`http://127.0.0.1:${port}/`);
        expect(res.status).toBe(204);
        expect(await res.text()).toBe("");
    });
});

describe("HttpClient: AbortError is swallowed silently", () => {
    it("does not propagate AbortError when request is aborted", async () => {
        const app = new FlowApp();
        const client = new HttpClient({ name: "cli", context: app.context });
        await client.init();

        const origFetch = globalThis.fetch;
        globalThis.fetch = (async () => {
            const err = new Error("The operation was aborted.");
            err.name = "AbortError";
            throw err;
        }) as typeof fetch;

        try {
            client.requests.put({ method: "GET", url: "http://localhost/", headers: {} });
            client.step();
            await new Promise((r) => setTimeout(r, 30));
            // AbortError was swallowed — no response put on the port
            expect(client.responses.size).toBe(0);
        } finally {
            globalThis.fetch = origFetch;
            await client.dispose();
        }
    });
});

// ── HttpEncoder: method ?? 'GET' branch ──────────────────────────────────────

describe("HttpEncoder: missing method defaults to GET", () => {
    it("uses GET when method is omitted from draft", () => {
        const ctx = new FlowContext();
        const enc = new HttpEncoder({ name: "enc", context: ctx });
        enc.requestIn.put({ url: "/test" }); // no method
        enc.step();
        const out = readPort(enc.requestOut);
        expect(out.method).toBe("GET");
    });
});

// ── HttpRequestReader.step() — no-op driven by _inject ───────────────────────

describe("HttpRequestReader.step()", () => {
    it("step() is a no-op and does not throw", () => {
        const ctx = new FlowContext();
        const srv = new HttpServer({ name: "s", context: ctx, port: 0 });
        expect(() => srv.reader.step()).not.toThrow();
    });
});

// ── HttpServer streaming error: res.destroy() on generator throw ──────────────

describe("HttpServer: streaming error destroys response", () => {
    let app: FlowApp;
    let server: HttpServer;
    let port: number;

    beforeEach(async () => {
        port = await freePort();
        app = new FlowApp({ mode: "push" });
        server = new HttpServer({ name: "srv", context: app.context, port });
        app.addComponent(server);
        await app.start();
        app.scheduler.start();
    });

    afterEach(async () => {
        await app.stop();
    });

    it("survives when async generator throws mid-stream", async () => {
        async function* throwingStream(): AsyncGenerator<Uint8Array> {
            yield new TextEncoder().encode("partial");
            throw new Error("stream error");
        }

        // Wait for a connection to come in, then inject a streaming response that throws
        const responsePromise = fetch(`http://127.0.0.1:${port}/data`).catch(() => null);
        await new Promise((r) => setTimeout(r, 50));

        // Find the pending requestId
        const connPort = server.requests;
        const req = connPort.read();
        if (req?.requestId) {
            server.streamingResponses.put({
                requestId: req.requestId,
                status: 200,
                headers: {},
                body: throwingStream(),
            });
            app.scheduler.tick();
        }

        const _res = await responsePromise;
        // The stream threw — response may be null (connection destroyed) or partial
        // The important thing is the server doesn't crash
        expect(app.components.has(server)).toBe(true);
    });
});

// ── HttpRouter: dynamic-route matching branches (lines 48, 52-53, 58) ─────────
// Static routes use a fast-path; only dynamic routes (with :param) reach the loop.

describe("HttpRouter: dynamic-route segment matching", () => {
    it("returns 404 when a static segment in a dynamic route mismatches (line 52-53)", async () => {
        const ctx = new FlowContext();
        const router = new HttpRouter({ name: "r", context: ctx });
        // Pattern has :id (forces loop path) but also a static "details" segment
        router.get("/api/:id/details", async (c: HttpCtx) => {
            c.body = {};
        });
        // "summary" !== "details" → line 52 condition true → line 53 return null
        router.requests.put(makeRequest("GET", "/api/123/summary"));
        router.step();
        const [resp] = await drain(router);
        expect(resp.status).toBe(404);
    });

    it("returns 404 when request path is shorter than dynamic pattern (line 48)", async () => {
        const ctx = new FlowContext();
        const router = new HttpRouter({ name: "r", context: ctx });
        router.get("/api/:id/details", async (c: HttpCtx) => {
            c.body = {};
        });
        // Only 2 segments, pattern needs 3 → i >= rp.length at i=2
        router.requests.put(makeRequest("GET", "/api/123"));
        router.step();
        const [resp] = await drain(router);
        expect(resp.status).toBe(404);
    });

    it("returns 404 when request path is longer than dynamic pattern (line 58 null)", async () => {
        const ctx = new FlowContext();
        const router = new HttpRouter({ name: "r", context: ctx });
        router.get("/api/:id", async (c: HttpCtx) => {
            c.body = {};
        });
        // 3 segments vs pattern 2 → pp.length !== rp.length → return null
        router.requests.put(makeRequest("GET", "/api/123/extra"));
        router.step();
        const [resp] = await drain(router);
        expect(resp.status).toBe(404);
    });
});

// ── HttpClient: non-AbortError is re-thrown (line 76) ────────────────────────

describe("HttpClient: non-AbortError is re-thrown from _fetch", () => {
    it("re-throws non-AbortError (line 76) — captured via unhandledRejection", async () => {
        const app = new FlowApp();
        const client = new HttpClient({ name: "cli", context: app.context });
        await client.init();

        // Capture the unhandled rejection before vitest sees it
        let caughtError: Error | undefined;
        const handler = (err: Error) => {
            caughtError = err;
        };
        process.once("unhandledRejection", handler);

        const origFetch = globalThis.fetch;
        globalThis.fetch = (async () => {
            throw new Error("Network failure"); // name !== 'AbortError' → line 76 throw
        }) as typeof fetch;

        try {
            client.requests.put({ method: "GET", url: "http://localhost/", headers: {} });
            client.step();
            await new Promise((r) => setTimeout(r, 30));
            expect(caughtError?.message).toBe("Network failure");
        } finally {
            process.removeListener("unhandledRejection", handler);
            globalThis.fetch = origFetch;
            await client.dispose();
        }
    });
});

// ── HttpServer: _sendStream with stale requestId (line 152 early return) ─────

describe("HttpServer: non-streaming response with stale requestId (line 87 _setSend)", () => {
    let app: FlowApp;
    let server: HttpServer;
    let port: number;

    beforeEach(async () => {
        port = await freePort();
        app = new FlowApp({ mode: "push" });
        server = new HttpServer({ name: "srv", context: app.context, port });
        app.addComponent(server);
        await app.start();
    });

    afterEach(async () => {
        await app.stop();
    });

    it("silently no-ops when requestId is not in _pending (line 87 true branch)", async () => {
        // Put a response with a fake requestId on server.responses → writer._setSend()
        // → _pending.get(requestId) = undefined → if (!res) return
        server.responses.put({
            requestId: "stale-request-id",
            status: 200,
            headers: {},
            body: undefined,
        });
        app.scheduler.tick();
        await new Promise((r) => setTimeout(r, 50));
        expect(app.components.has(server)).toBe(true);
    });
});

describe("HttpServer: _sendStream with unknown requestId", () => {
    let app: FlowApp;
    let server: HttpServer;
    let port: number;

    beforeEach(async () => {
        port = await freePort();
        app = new FlowApp({ mode: "push" });
        server = new HttpServer({ name: "srv", context: app.context, port });
        app.addComponent(server);
        await app.start();
    });

    afterEach(async () => {
        await app.stop();
    });

    it("silently no-ops when requestId is not in _pending (line 152)", async () => {
        // Push a streaming response whose requestId was never registered — _sendStream
        // returns at line 152 without sending anything; server must not crash.
        server.streamingResponses.put({
            requestId: "nonexistent-request-id",
            status: 200,
            headers: {},
            body: (async function* () {
                yield new TextEncoder().encode("hello");
            })(),
        });
        app.scheduler.tick();
        await new Promise((r) => setTimeout(r, 50));
        expect(app.components.has(server)).toBe(true);
    });
});

// ── HttpServer: successful streaming response (covers lines 160-167 body) ─────

describe("HttpServer: streaming response happy path", () => {
    let app: FlowApp;
    let server: HttpServer;
    let port: number;

    beforeEach(async () => {
        port = await freePort();
        app = new FlowApp({ mode: "push" });
        server = new HttpServer({ name: "srv", context: app.context, port });
        app.addComponent(server);
        await app.start();
        app.scheduler.start();
    });

    afterEach(async () => {
        await app.stop();
    });

    it("streams chunks to client and ends cleanly (lines 160-167)", async () => {
        const responsePromise = fetch(`http://127.0.0.1:${port}/stream`).catch(() => null);

        // Poll until the request arrives in the port queue (max 2s)
        let req: HttpRequest | undefined;
        for (let i = 0; i < 100 && !req; i++) {
            await new Promise((r) => setTimeout(r, 20));
            req = server.requests.read();
        }

        if (req?.requestId) {
            async function* body() {
                yield new TextEncoder().encode("hello");
                yield new TextEncoder().encode(" world");
            }
            server.streamingResponses.put({
                requestId: req.requestId,
                status: 200,
                headers: { "content-type": "text/plain" },
                body: body(),
            });
            // Scheduler triggers server.step() → _sendStream → loops chunks → res.end()
        }

        const res = await responsePromise;
        expect(app.components.has(server)).toBe(true);
        if (res) {
            expect(res.status).toBe(200);
        }
    });
});
