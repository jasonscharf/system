import { getLogger } from "@jasonscharf/core";
import { FlowComponent, type FlowComponentOptions } from "../../FlowComponent.js";
import type { FlowPort } from "../../FlowPort.js";
import { HttpCtx } from "./HttpCtx.js";
import type { HttpHeaders, HttpMethod, HttpResponseDraft, ParsedHttpRequest } from "./HttpTypes.js";

const log = getLogger("HttpRouter");

// ── Compose (local copy — flow package has no dep on @system/app) ─────────────

type Next = () => Promise<void>;
type MiddlewareFn<T> = (ctx: T, next: Next) => Promise<void>;

function compose<T>(fns: MiddlewareFn<T>[]): MiddlewareFn<T> {
    return async (ctx: T, finalNext: Next) => {
        let depth = -1;
        const dispatch = async (i: number): Promise<void> => {
            if (i <= depth) {
                throw new Error("next() called multiple times");
            }
            depth = i;
            const fn = i < fns.length ? fns[i] : finalNext;
            if (fn) {
                await fn(ctx, () => dispatch(i + 1));
            }
        };
        return dispatch(0);
    };
}

// ── Path matching ─────────────────────────────────────────────────────────────

function matchPath(pattern: string, pathname: string): Record<string, string> | null {
    const params: Record<string, string> = {};

    // Fast-path: exact match (most common case for static routes)
    if (!pattern.includes(":") && !pattern.includes("*")) {
        return pattern === pathname ? params : null;
    }

    const pp = pattern.split("/").filter(Boolean);
    const rp = pathname.split("/").filter(Boolean);

    for (let i = 0; i < pp.length; i++) {
        const seg = pp[i];

        if (seg === "*") {
            // Greedy wildcard — captures remaining segments
            params["*"] = rp.slice(i).join("/");
            return params;
        }

        if (i >= rp.length) {
            return null;
        }

        if (seg.startsWith(":")) {
            params[seg.slice(1)] = decodeURIComponent(rp[i]);
        } else if (seg !== rp[i]) {
            return null;
        }
    }

    // Pattern consumed — ensure no leftover path segments (unless wildcard used)
    return pp.length === rp.length ? params : null;
}

// ── Content-type inference ────────────────────────────────────────────────────

function inferContentType(body: unknown, headers: HttpHeaders): string | undefined {
    const existing = headers["content-type"];
    if (existing) {
        return Array.isArray(existing) ? existing[0] : existing;
    }
    if (body instanceof Uint8Array) {
        return "application/octet-stream";
    }
    if (typeof body === "string") {
        return "text/plain; charset=utf-8";
    }
    if (body !== null && body !== undefined) {
        return "application/json";
    }
    return undefined;
}

// ── Route record ──────────────────────────────────────────────────────────────

export type HttpMiddlewareFn = MiddlewareFn<HttpCtx>;

interface Route {
    method: HttpMethod | null; // null = any method (middleware)
    pattern: string;
    fn: HttpMiddlewareFn;
}

// ── HttpRouter ────────────────────────────────────────────────────────────────

export interface HttpRouterOptions extends FlowComponentOptions {
    /**
     * Extra values merged onto every HttpCtx — use to inject app-level
     * dependencies (database handle, logger, feature flags …).
     */
    extras?: Record<string, unknown>;
}

/**
 * Express/Koa-style HTTP router as a Flow component.
 *
 * Plug it between HttpDecoder and HttpEncoder in the FBP pipeline:
 *
 *   HttpServer.requests
 *     → HttpDecoder.requestIn → HttpDecoder.requestOut
 *     → HttpRouter.requests
 *     → HttpRouter.responses
 *     → HttpEncoder.responseIn → HttpEncoder.responseOut
 *   → HttpServer.responses
 *
 * Routing API mirrors Express and Koa Router:
 *
 *   const router = new HttpRouter({ name: 'api', context: app.context });
 *
 *   // Global middleware
 *   router.use(async (ctx, next) => {
 *       ctx.headers['x-powered-by'] = 'tern';
 *       await next();
 *   });
 *
 *   // Error boundary
 *   router.use(async (ctx, next) => {
 *       try { await next(); }
 *       catch (err) { ctx.send(500, { error: String(err) }); }
 *   });
 *
 *   // Method + path handlers
 *   router.get('/ping',           async ctx => { ctx.body = { pong: true }; });
 *   router.get('/users/:id',      async ctx => { ctx.body = await getUser(ctx.params.id); });
 *   router.post('/users',         async ctx => { ctx.status = 201; ctx.body = await createUser(ctx.req.body); });
 *   router.delete('/users/:id',   async ctx => { ctx.status = 204; });
 *
 *   // Mount sub-router under a path prefix
 *   const v1 = new HttpRouter({ name: 'v1', context: app.context });
 *   v1.get('/version', async ctx => { ctx.body = { version: '1.0.0' }; });
 *   router.mount('/v1', v1);
 */
export class HttpRouter extends FlowComponent {
    readonly requests: FlowPort<ParsedHttpRequest>;
    readonly responses: FlowPort<HttpResponseDraft>;

    private readonly _routes: Route[] = [];
    private readonly _mounts: Array<{ prefix: string; router: HttpRouter }> = [];
    private readonly _extras: Record<string, unknown>;

    constructor(options: HttpRouterOptions) {
        super(options);
        this._extras = options.extras ?? {};
        this.requests = this.addPort<ParsedHttpRequest>("requests", "in");
        this.responses = this.addPort<HttpResponseDraft>("responses", "out");
    }

    // ── Middleware ────────────────────────────────────────────────────────────

    /** Register path-independent middleware (runs for every request). */
    use(fn: HttpMiddlewareFn): this;
    /** Register middleware scoped to a path prefix. */
    use(prefix: string, ...fns: HttpMiddlewareFn[]): this;
    use(prefixOrFn: string | HttpMiddlewareFn, ...rest: HttpMiddlewareFn[]): this {
        if (typeof prefixOrFn === "function") {
            this._routes.push({ method: null, pattern: "/*", fn: prefixOrFn });
        } else {
            const prefix = prefixOrFn.endsWith("/") ? `${prefixOrFn}*` : `${prefixOrFn}/*`;
            this._routes.push({ method: null, pattern: prefix, fn: compose(rest) });
        }
        return this;
    }

    // ── Method handlers ───────────────────────────────────────────────────────

    /** Handle GET requests matching `path`. */
    get(path: string, ...fns: HttpMiddlewareFn[]): this {
        return this._add("GET", path, fns);
    }
    /** Handle POST requests matching `path`. */
    post(path: string, ...fns: HttpMiddlewareFn[]): this {
        return this._add("POST", path, fns);
    }
    /** Handle PUT requests matching `path`. */
    put(path: string, ...fns: HttpMiddlewareFn[]): this {
        return this._add("PUT", path, fns);
    }
    /** Handle PATCH requests matching `path`. */
    patch(path: string, ...fns: HttpMiddlewareFn[]): this {
        return this._add("PATCH", path, fns);
    }
    /** Handle DELETE requests matching `path`. */
    delete(path: string, ...fns: HttpMiddlewareFn[]): this {
        return this._add("DELETE", path, fns);
    }
    /** Handle HEAD requests matching `path`. */
    head(path: string, ...fns: HttpMiddlewareFn[]): this {
        return this._add("HEAD", path, fns);
    }
    /** Handle any HTTP method matching `path`. */
    all(path: string, ...fns: HttpMiddlewareFn[]): this {
        return this._add(null, path, fns);
    }

    // ── Sub-routing ───────────────────────────────────────────────────────────

    /**
     * Mount a sub-router under `prefix`.  Requests whose pathname starts with
     * `prefix` are forwarded to `router` with the prefix stripped from the path.
     */
    mount(prefix: string, router: HttpRouter): this {
        this._mounts.push({ prefix: prefix.replace(/\/$/, ""), router });
        return this;
    }

    // ── FBP step ──────────────────────────────────────────────────────────────

    override step(): void {
        for (;;) {
            const req = this.requests.read();
            if (req === undefined) {
                break;
            }
            // Detached request handling: register as in-flight work so
            // FlowApp.stop() drains it before disposing (graceful-drain contract,
            // TRN-472). _handle never rejects — a throwing handler with no
            // error-boundary middleware yields a 500 response rather than an
            // unhandled rejection plus a leaked pending ServerResponse (TRN-528).
            this.trackInFlight(this._handle(req));
        }
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    private _add(method: HttpMethod | null, path: string, fns: HttpMiddlewareFn[]): this {
        this._routes.push({ method, pattern: path, fn: compose(fns) });
        return this;
    }

    private async _handle(req: ParsedHttpRequest): Promise<void> {
        const ctx = new HttpCtx(req, this._extras);

        try {
            const chain = this._buildChain(req.method, req.pathname, ctx);

            await compose(chain)(ctx, async () => {
                // After all handlers — if body is still unset and status is default, it's a 404
                if (ctx.body === undefined && ctx.status === 200) {
                    ctx.notFound();
                }
            });

            this.responses.put({
                requestId: req.requestId,
                status: ctx.status,
                headers: ctx.headers,
                body: ctx.body,
                contentType: inferContentType(ctx.body, ctx.headers),
            });
        } catch (err) {
            // A handler (or middleware) threw and no error-boundary middleware
            // caught it. Log it and emit a default 500 so the client always gets
            // a response and the pending ServerResponse is never leaked (TRN-528).
            // Apps that want custom error bodies still install their own boundary.
            const message = err instanceof Error ? err.message : String(err);
            log.error("unhandled error handling request", {
                component: this.name,
                method: req.method,
                pathname: req.pathname,
                error: message,
            });
            this.responses.put({
                requestId: req.requestId,
                status: 500,
                headers: {},
                body: { error: "Internal Server Error" },
                contentType: "application/json",
            });
        }
    }

    private _buildChain(method: HttpMethod, pathname: string, ctx: HttpCtx): HttpMiddlewareFn[] {
        const chain: HttpMiddlewareFn[] = [];

        for (const route of this._routes) {
            if (route.method && route.method !== method) {
                continue;
            }

            const params = matchPath(route.pattern, pathname);
            if (params === null) {
                continue;
            }

            chain.push(async (c, next) => {
                Object.assign(c.params, params);
                await route.fn(c, next);
            });
        }

        // Delegate to mounted sub-routers
        for (const { prefix, router } of this._mounts) {
            if (!pathname.startsWith(prefix)) {
                continue;
            }
            const subPath = pathname.slice(prefix.length) || "/";
            const subChain = router._buildChain(method, subPath, ctx);
            chain.push(...subChain);
        }

        return chain;
    }
}
