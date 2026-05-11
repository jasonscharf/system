import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FlowContext, FlowApp } from '@system/flow';
import {
    okResult, errResult, command, query, TERN_TYPES,
    type TernRequest, type TernResult,
} from '@system/core';
import {
    TernRouter, type TernCtx,
} from '@system/app';
import {
    HttpRouter, HttpCtx,
    type ParsedHttpRequest,
} from '@system/flow';


// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(method: string, pathname: string, overrides: Partial<ParsedHttpRequest> = {}): ParsedHttpRequest {
    return {
        method: method as ParsedHttpRequest['method'],
        url: pathname,
        pathname,
        searchParams: new URLSearchParams(),
        headers: {},
        requestId: 'r1',
        ...overrides,
    };
}

async function drainResponses(router: HttpRouter, count = 1, timeoutMs = 200) {
    const deadline = Date.now() + timeoutMs;
    const results = [];
    while (results.length < count && Date.now() < deadline) {
        const r = router.responses.read();
        if (r !== undefined) { results.push(r); }
        else { await new Promise(t => setTimeout(t, 5)); }
    }
    return results;
}


// ── TernRouter ────────────────────────────────────────────────────────────────

describe('TernRouter', () => {
    it('dispatches to a registered handler', async () => {
        const router = new TernRouter();
        router.handle(TERN_TYPES.ping, async ctx => {
            ctx.result = okResult(ctx.request.id, ctx.request.type, { pong: true });
        });

        const result = await router.dispatch(query(TERN_TYPES.ping), { connectionId: 'c1' });
        expect(result.ok).toBe(true);
        expect((result.data as { pong: boolean }).pong).toBe(true);
    });

    it('returns an error result for an unregistered type', async () => {
        const router = new TernRouter();
        const result = await router.dispatch(query(TERN_TYPES.ping), { connectionId: 'c1' });
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/No handler/);
    });

    it('runs global middleware before the route handler', async () => {
        const order: string[] = [];
        const router = new TernRouter();
        router.use(async (_ctx, next) => { order.push('mw'); await next(); });
        router.handle(TERN_TYPES.ping, async ctx => {
            order.push('handler');
            ctx.result = okResult(ctx.request.id, ctx.request.type, null);
        });

        await router.dispatch(query(TERN_TYPES.ping), { connectionId: 'c1' });
        expect(order).toEqual(['mw', 'handler']);
    });

    it('middleware can short-circuit the chain without calling next()', async () => {
        const handlerSpy = vi.fn();
        const router = new TernRouter();
        router.use(async (ctx, _next) => {
            ctx.result = errResult(ctx.request.id, ctx.request.type, 'blocked by middleware');
        });
        router.handle(TERN_TYPES.ping, async ctx => {
            handlerSpy();
            ctx.result = okResult(ctx.request.id, ctx.request.type, null);
        });

        const result = await router.dispatch(query(TERN_TYPES.ping), { connectionId: 'c1' });
        expect(result.ok).toBe(false);
        expect(result.error).toBe('blocked by middleware');
        expect(handlerSpy).not.toHaveBeenCalled();
    });

    it('middleware can wrap the handler (before + after pattern)', async () => {
        const log: string[] = [];
        const router = new TernRouter();
        router.use(async (ctx, next) => {
            log.push('before');
            await next();
            log.push('after');
        });
        router.handle(TERN_TYPES.ping, async ctx => {
            log.push('handler');
            ctx.result = okResult(ctx.request.id, ctx.request.type, null);
        });

        await router.dispatch(query(TERN_TYPES.ping), { connectionId: 'c1' });
        expect(log).toEqual(['before', 'handler', 'after']);
    });

    it('supports multiple middleware in sequence', async () => {
        const order: number[] = [];
        const router = new TernRouter();
        router.use(async (_ctx, next) => { order.push(1); await next(); });
        router.use(async (_ctx, next) => { order.push(2); await next(); });
        router.handle(TERN_TYPES.ping, async ctx => {
            order.push(3);
            ctx.result = okResult(ctx.request.id, ctx.request.type, null);
        });

        await router.dispatch(query(TERN_TYPES.ping), { connectionId: 'c1' });
        expect(order).toEqual([1, 2, 3]);
    });

    it('multiple handlers on the same route are composed in order', async () => {
        const order: string[] = [];
        const router = new TernRouter();
        router.handle(TERN_TYPES.ping,
            async (_ctx, next) => { order.push('a'); await next(); },
            async (ctx,  _next) => { order.push('b'); ctx.result = okResult(ctx.request.id, ctx.request.type, null); },
        );

        await router.dispatch(query(TERN_TYPES.ping), { connectionId: 'c1' });
        expect(order).toEqual(['a', 'b']);
    });

    it('middleware can add properties to ctx (Koa-style)', async () => {
        const router = new TernRouter();
        router.use(async (ctx, next) => {
            ctx['user'] = { id: 42 };
            await next();
        });
        let capturedUser: unknown;
        router.handle(TERN_TYPES.ping, async ctx => {
            capturedUser = ctx['user'];
            ctx.result = okResult(ctx.request.id, ctx.request.type, null);
        });

        await router.dispatch(query(TERN_TYPES.ping), { connectionId: 'c1' });
        expect((capturedUser as { id: number }).id).toBe(42);
    });

    it('mounts a sub-router and dispatches to its handlers', async () => {
        const main = new TernRouter();
        const sub  = new TernRouter();

        sub.handle(TERN_TYPES.echo, async ctx => {
            ctx.result = okResult(ctx.request.id, ctx.request.type, 'from sub');
        });
        main.mount(sub);

        const result = await main.dispatch(query(TERN_TYPES.echo), { connectionId: 'c1' });
        expect(result.ok).toBe(true);
        expect(result.data).toBe('from sub');
    });

    it('global middleware on main runs before sub-router handler', async () => {
        const order: string[] = [];
        const main = new TernRouter();
        const sub  = new TernRouter();

        main.use(async (_ctx, next) => { order.push('main-mw'); await next(); });
        sub.handle(TERN_TYPES.echo, async ctx => {
            order.push('sub-handler');
            ctx.result = okResult(ctx.request.id, ctx.request.type, null);
        });
        main.mount(sub);

        await main.dispatch(query(TERN_TYPES.echo), { connectionId: 'c1' });
        expect(order).toEqual(['main-mw', 'sub-handler']);
    });

    it('extra ctx fields from extras option are available in handlers', async () => {
        const router = new TernRouter();
        let seen: unknown;
        router.handle(TERN_TYPES.ping, async ctx => {
            seen = ctx['store'];
            ctx.result = okResult(ctx.request.id, ctx.request.type, null);
        });

        await router.dispatch(query(TERN_TYPES.ping), { connectionId: 'c1', store: 'my-store' });
        expect(seen).toBe('my-store');
    });

    it('middleware error boundary catches handler throws', async () => {
        const router = new TernRouter();
        router.use(async (ctx, next) => {
            try { await next(); }
            catch { ctx.result = errResult(ctx.request.id, ctx.request.type, 'caught'); }
        });
        router.handle(TERN_TYPES.ping, async () => { throw new Error('boom'); });

        const result = await router.dispatch(query(TERN_TYPES.ping), { connectionId: 'c1' });
        expect(result.ok).toBe(false);
        expect(result.error).toBe('caught');
    });
});


// ── HttpRouter ────────────────────────────────────────────────────────────────

describe('HttpRouter', () => {
    let ctx: FlowContext;
    beforeEach(() => { ctx = new FlowContext(); });

    it('routes GET /ping to a handler', async () => {
        const router = new HttpRouter({ name: 'r', context: ctx });
        router.get('/ping', async c => { c.body = { pong: true }; });

        router.requests.put(makeReq('GET', '/ping'));
        router.step();
        const [resp] = await drainResponses(router);
        expect(resp.status).toBe(200);
        expect((resp.body as { pong: boolean }).pong).toBe(true);
    });

    it('returns 404 for unmatched routes', async () => {
        const router = new HttpRouter({ name: 'r', context: ctx });
        router.get('/ping', async c => { c.body = {}; });

        router.requests.put(makeReq('GET', '/notfound'));
        router.step();
        const [resp] = await drainResponses(router);
        expect(resp.status).toBe(404);
    });

    it('does not match wrong HTTP method', async () => {
        const router = new HttpRouter({ name: 'r', context: ctx });
        router.post('/data', async c => { c.body = {}; });

        router.requests.put(makeReq('GET', '/data'));
        router.step();
        const [resp] = await drainResponses(router);
        expect(resp.status).toBe(404);
    });

    it('extracts named path params', async () => {
        const router = new HttpRouter({ name: 'r', context: ctx });
        let id: string | undefined;
        router.get('/users/:id', async c => { id = c.params['id']; c.body = {}; });

        router.requests.put(makeReq('GET', '/users/42'));
        router.step();
        await drainResponses(router);
        expect(id).toBe('42');
    });

    it('extracts multiple path params', async () => {
        const router = new HttpRouter({ name: 'r', context: ctx });
        let captured: Record<string, string> | undefined;
        router.get('/orgs/:org/repos/:repo', async c => {
            captured = { ...c.params };
            c.body = {};
        });

        router.requests.put(makeReq('GET', '/orgs/tern/repos/core'));
        router.step();
        await drainResponses(router);
        expect(captured).toEqual({ org: 'tern', repo: 'core' });
    });

    it('wildcard * matches remaining path', async () => {
        const router = new HttpRouter({ name: 'r', context: ctx });
        let wildcard: string | undefined;
        router.get('/static/*', async c => { wildcard = c.params['*']; c.body = {}; });

        router.requests.put(makeReq('GET', '/static/images/logo.png'));
        router.step();
        await drainResponses(router);
        expect(wildcard).toBe('images/logo.png');
    });

    it('runs global middleware for every request', async () => {
        const router = new HttpRouter({ name: 'r', context: ctx });
        let mwRan = false;
        router.use(async (_c, next) => { mwRan = true; await next(); });
        router.get('/ping', async c => { c.body = {}; });

        router.requests.put(makeReq('GET', '/ping'));
        router.step();
        await drainResponses(router);
        expect(mwRan).toBe(true);
    });

    it('middleware runs before route handler (wrapping pattern)', async () => {
        const router = new HttpRouter({ name: 'r', context: ctx });
        const log: string[] = [];
        router.use(async (c, next) => { log.push('before'); await next(); log.push('after'); });
        router.get('/ping', async c => { log.push('handler'); c.body = {}; });

        router.requests.put(makeReq('GET', '/ping'));
        router.step();
        await drainResponses(router);
        expect(log).toEqual(['before', 'handler', 'after']);
    });

    it('middleware can set response directly (short-circuit)', async () => {
        const router = new HttpRouter({ name: 'r', context: ctx });
        router.use(async c => { c.status = 401; c.body = { error: 'Unauthorized' }; });
        router.get('/secret', async c => { c.body = { secret: 'data' }; });

        router.requests.put(makeReq('GET', '/secret'));
        router.step();
        const [resp] = await drainResponses(router);
        expect(resp.status).toBe(401);
    });

    it('.all() matches any HTTP method', async () => {
        const router = new HttpRouter({ name: 'r', context: ctx });
        const methods: string[] = [];
        router.all('/probe', async c => { methods.push(c.req.method); c.body = {}; });

        for (const method of ['GET', 'POST', 'DELETE']) {
            router.requests.put(makeReq(method, '/probe'));
            router.step();
        }
        await drainResponses(router, 3);
        expect(methods).toEqual(['GET', 'POST', 'DELETE']);
    });

    it('mounts a sub-router under a prefix', async () => {
        const router = new HttpRouter({ name: 'r', context: ctx });
        const api    = new HttpRouter({ name: 'api', context: ctx });

        api.get('/version', async c => { c.body = { version: '1.0.0' }; });
        router.mount('/api', api);

        router.requests.put(makeReq('GET', '/api/version'));
        router.step();
        const [resp] = await drainResponses(router);
        expect(resp.status).toBe(200);
        expect((resp.body as { version: string }).version).toBe('1.0.0');
    });

    it('extras from constructor are available on ctx', async () => {
        const router = new HttpRouter({ name: 'r', context: ctx, extras: { db: 'my-db' } });
        let seen: unknown;
        router.get('/check', async c => { seen = c['db']; c.body = {}; });

        router.requests.put(makeReq('GET', '/check'));
        router.step();
        await drainResponses(router);
        expect(seen).toBe('my-db');
    });

    it('echoes requestId from inbound ParsedHttpRequest', async () => {
        const router = new HttpRouter({ name: 'r', context: ctx });
        router.get('/ping', async c => { c.body = {}; });

        router.requests.put(makeReq('GET', '/ping', { requestId: 'req-42' }));
        router.step();
        const [resp] = await drainResponses(router);
        expect(resp.requestId).toBe('req-42');
    });

    it('infers content-type as application/json for object bodies', async () => {
        const router = new HttpRouter({ name: 'r', context: ctx });
        router.get('/data', async c => { c.body = { x: 1 }; });

        router.requests.put(makeReq('GET', '/data'));
        router.step();
        const [resp] = await drainResponses(router);
        expect(resp.contentType).toContain('application/json');
    });
});
