/**
 * Sandbox server — a minimal Tern application loaded from config.
 *
 * Boot sequence:
 *   1. Open the SQLite triple store (seeded with well-known namespaces).
 *   2. Load app config from  config/app.yaml, which references:
 *        config/extensions/core.yaml   — ping handler (YAML format)
 *        config/extensions/data.ttl    — triple-store handlers (Turtle/RDF)
 *   3. TernApp merges extension configs, builds the HandlerRegistry.
 *   4. Two FBP pipelines are wired:
 *        WS pipeline:   WS → decode → route → encode → WS
 *        HTTP pipeline: HTTP → decode → AuthRouter → encode → HTTP
 *   5. Session management works across both WS and HTTP transports.
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { FlowApp, HttpServer, HttpDecoder, HttpEncoder, HttpRouter } from '@system/flow';
import { WebSocketServer } from '@system/flow';
import { TernApp } from '@system/app';
import { createDataContext, TripleStore } from '@system/data';
import {
    AuthRouterComponent,
    GoogleProvider,
    GitHubProvider,
    MemorySessionStore,
    UserRepository,
    UserIdentityRepository,
    UserSessionRepository,
    UserDeviceRepository,
} from '@system/auth';
import { MessageDecoder } from './components/MessageDecoder.js';
import { MessageEncoder } from './components/MessageEncoder.js';
import { MessageRouter } from './components/MessageRouter.js';


const WS_PORT   = Number(process.env['PORT']         ?? 8080);
const HTTP_PORT = Number(process.env['AUTH_PORT']     ?? 8081);
const DB_PATH   = process.env['TERN_DB_PATH']         ?? ':memory:';
const BASE_URL  = process.env['AUTH_BASE_URL']        ?? `http://localhost:${HTTP_PORT}`;
const CONFIG    = resolve(fileURLToPath(new URL('../config/app.yaml', import.meta.url)));

async function main(): Promise<void> {
    // ── Data layer ────────────────────────────────────────────────────────────
    const knex  = await createDataContext({ client: 'sqlite', filename: DB_PATH });
    const store = new TripleStore(knex);

    await store.ensureNamespace('tern', 'http://tern.dev/ns/');
    await store.ensureNamespace('rdf',  'http://www.w3.org/1999/02/22-rdf-syntax-ns#');
    await store.ensureNamespace('rdfs', 'http://www.w3.org/2000/01/rdf-schema#');
    await store.ensureNamespace('auth', 'http://tern.dev/ns/auth/');

    // ── Auth repositories (share the same triple store) ───────────────────────
    const users      = new UserRepository(store);
    const identities = new UserIdentityRepository(store);
    const sessions   = new UserSessionRepository(store);
    const devices    = new UserDeviceRepository(store);

    // ── Session store: MemorySessionStore for dev; swap for RedisSessionStore in prod ──
    const sessionStore = new MemorySessionStore();

    // ── Application config ────────────────────────────────────────────────────
    const ternApp = await TernApp.fromYAML(CONFIG, { context: { store } });

    console.log(`[sandbox-server] Loaded config: ${ternApp.config.name} v${ternApp.config.version ?? '?'}`);
    console.log(`[sandbox-server] Registered types: ${ternApp.registry.registeredTypes.join(', ')}`);

    // ── Shared FBP context ────────────────────────────────────────────────────
    const flowApp = new FlowApp({ mode: 'push' });

    // ── Auth router ───────────────────────────────────────────────────────────
    const authRouter = new AuthRouterComponent({
        name:         'auth',
        context:      flowApp.context,
        providers:    [
            new GoogleProvider(),
            new GitHubProvider(),
        ],
        sessionStore,
        users,
        identities,
        sessions,
        devices,
        baseUrl:      BASE_URL,
        loginSuccess: `http://localhost:${HTTP_PORT}/`,
        loginFailure: `http://localhost:${HTTP_PORT}/auth/error`,
    });

    // ── HTTP pipeline (auth + CORS) ───────────────────────────────────────────
    const httpServer  = new HttpServer({ name: 'http',    context: flowApp.context, port: HTTP_PORT });
    const httpDecoder = new HttpDecoder({ name: 'httpDec', context: flowApp.context });
    const httpEncoder = new HttpEncoder({ name: 'httpEnc', context: flowApp.context });

    // Top-level HTTP router that mounts auth and serves a simple health check
    const topRouter = new HttpRouter({ name: 'top', context: flowApp.context });

    // CORS preflight
    topRouter.use(async (ctx, next) => {
        ctx.headers['access-control-allow-origin']  = '*';
        ctx.headers['access-control-allow-headers'] = 'Authorization, Content-Type';
        ctx.headers['access-control-allow-methods'] = 'GET, POST, OPTIONS';
        if (ctx.method === 'OPTIONS') { ctx.status = 204; ctx.body = null; return; }
        await next();
    });

    // Health check
    topRouter.get('/', async ctx => {
        ctx.body = { ok: true, server: 'tern-sandbox', wsPort: WS_PORT };
    });

    // Mount auth router's HttpRouter so auth routes are handled by the pipeline
    topRouter.mount('/auth', authRouter.httpRouter);

    flowApp
        .addComponent(httpServer)
        .addComponent(httpDecoder)
        .addComponent(topRouter)
        .addComponent(httpEncoder)
        .addComponent(authRouter)
        .connect(httpServer.requests,   httpDecoder.requestIn)
        .connect(httpDecoder.requestOut, topRouter.requests)
        .connect(topRouter.responses,    httpEncoder.responseIn)
        .connect(httpEncoder.responseOut, httpServer.responses);

    // ── WebSocket pipeline ────────────────────────────────────────────────────
    const wsServer = new WebSocketServer({ name: 'ws',      context: flowApp.context, port: WS_PORT });
    const decoder  = new MessageDecoder({ name: 'decoder',  context: flowApp.context });
    const router   = new MessageRouter({
        name:           'router',
        context:         flowApp.context,
        dispatcher:      ternApp.registry,
        handlerContext:  { store },
    });
    const encoder  = new MessageEncoder({ name: 'encoder',  context: flowApp.context });

    flowApp
        .addComponent(wsServer)
        .addComponent(decoder)
        .addComponent(router)
        .addComponent(encoder)
        .connect(wsServer.received, decoder.in)
        .connect(decoder.out,       router.in)
        .connect(router.out,        encoder.in)
        .connect(encoder.out,       wsServer.send);

    await flowApp.start();
    flowApp.scheduler.start();

    console.log(`[sandbox-server] WS listening on  ws://127.0.0.1:${WS_PORT}`);
    console.log(`[sandbox-server] HTTP listening on http://127.0.0.1:${HTTP_PORT}`);
    console.log(`[sandbox-server] Auth base URL: ${BASE_URL}`);
    console.log(`[sandbox-server] DB: ${DB_PATH}`);

    process.once('SIGINT', async () => {
        console.log('\n[sandbox-server] Shutting down…');
        await flowApp.stop();
        await knex.destroy();
        process.exit(0);
    });
}

main().catch(err => {
    console.error('[sandbox-server] Fatal:', err);
    process.exit(1);
});
