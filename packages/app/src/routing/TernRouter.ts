import { errResult, type TernRequest, type TernResult, type TernTypeRef } from "@jasonscharf/core";
import { compose, type MiddlewareFn } from "./compose.js";
import type { Dispatcher } from "./Dispatcher.js";

// ── Context ───────────────────────────────────────────────────────────────────

/**
 * The context object passed to every middleware and handler.
 *
 * Handlers set `ctx.result` to produce a response.  Middleware can read and
 * write any property — including arbitrary extras — so it acts as a
 * Koa-style request-scoped store.
 */
export class TernCtx implements Record<string, unknown> {
    [key: string]: unknown;

    readonly request: TernRequest;
    result: TernResult | undefined = undefined;

    constructor(request: TernRequest, extras: Record<string, unknown>) {
        this.request = request;
        Object.assign(this, extras);
    }
}

export type TernMiddlewareFn = MiddlewareFn<TernCtx>;

// ── Route / mount internals ───────────────────────────────────────────────────

interface Route {
    readonly typeIri: string;
    readonly fn: TernMiddlewareFn;
}

// ── TernRouter ────────────────────────────────────────────────────────────────

/**
 * Koa-style middleware router for Tern WS message dispatch.
 *
 * Usage:
 *
 *   const router = new TernRouter();
 *
 *   // Global middleware — runs for every request
 *   router.use(async (ctx, next) => {
 *       const t0 = Date.now();
 *       await next();
 *       console.log(`${ctx.request.type.iri} → ${Date.now() - t0}ms`);
 *   });
 *
 *   // Error boundary
 *   router.use(async (ctx, next) => {
 *       try { await next(); }
 *       catch (err) { ctx.result = errResult(ctx.request.id, ctx.request.type, String(err)); }
 *   });
 *
 *   // Type-specific handlers (compose multiple in order)
 *   router.handle(TERN_TYPES.ping, async ctx => {
 *       ctx.result = okResult(ctx.request.id, ctx.request.type, { ts: Date.now() });
 *   });
 *
 *   // Sub-router (all handlers accessible via mount)
 *   const dataRouter = new TernRouter();
 *   dataRouter.handle(TERN_TYPES.tripleFind, handleFind);
 *   router.mount(dataRouter);
 *
 *   // Dispatch (implements the Dispatcher interface)
 *   const result = await router.dispatch(request, { connectionId, store });
 */
export class TernRouter implements Dispatcher {
    private readonly _globalMiddleware: TernMiddlewareFn[] = [];
    private readonly _routes: Route[] = [];
    private readonly _mounts: TernRouter[] = [];

    // ── Registration ──────────────────────────────────────────────────────────

    /** Register middleware that runs for every request, before route handlers. */
    use(...fns: TernMiddlewareFn[]): this {
        this._globalMiddleware.push(...fns);
        return this;
    }

    /**
     * Register one or more handler functions for a specific message type.
     * Multiple functions are composed left-to-right (Koa-style); each must call
     * `next()` to continue to the following function.
     */
    handle(typeRef: TernTypeRef, ...fns: TernMiddlewareFn[]): this {
        this._routes.push({ typeIri: typeRef.iri, fn: compose(fns) });
        return this;
    }

    /**
     * Mount a sub-router.  All handlers registered on the sub-router become
     * available through this router; global middleware on this router runs
     * before sub-router handlers.
     */
    mount(router: TernRouter): this {
        this._mounts.push(router);
        return this;
    }

    // ── Dispatch ──────────────────────────────────────────────────────────────

    /**
     * Dispatch a request through the middleware chain.
     *
     * @param request - the inbound TernRequest
     * @param extras  - merged into ctx (e.g. { connectionId, store, user })
     */
    async dispatch(request: TernRequest, extras: Record<string, unknown>): Promise<TernResult> {
        const ctx = new TernCtx(request, extras);

        // Build the full chain: global middleware → type-matched handler
        const route = this._findRoute(request.type.iri);
        const chain: TernMiddlewareFn[] = [...this._globalMiddleware];
        if (route) {
            chain.push(route.fn);
        }

        await compose(chain)(ctx, async () => {
            // Reached the end of the chain with no result → error
            if (!ctx.result) {
                ctx.result = errResult(
                    request.id,
                    request.type,
                    `No handler registered for "${request.type.iri}"`,
                );
            }
        });

        if (ctx.result == null) {
            throw new Error("TernRouter: dispatch produced no result");
        }
        return ctx.result;
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    private _findRoute(typeIri: string): Route | undefined {
        const own = this._routes.find((r) => r.typeIri === typeIri);
        if (own) {
            return own;
        }
        for (const sub of this._mounts) {
            const found = sub._findRoute(typeIri);
            if (found) {
                return found;
            }
        }
        return undefined;
    }
}
