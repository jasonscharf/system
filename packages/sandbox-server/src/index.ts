/**
 * Sandbox server — a minimal Tern application loaded from config.
 *
 * Boot sequence:
 *   1. Init SecretsManager (Azure Key Vault in staging/prod; env vars locally).
 *   2. Open the triple store (PostgreSQL).
 *   3. Load app config from config/app.yaml → HandlerRegistry.
 *   4. Wire two FBP pipelines:
 *        WS pipeline:   WS → decode → route → encode → WS
 *        HTTP pipeline: HTTP → decode → AuthRouter → encode → HTTP
 *   5. Session management shared across WS and HTTP.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TernApp } from "@jasonscharf/app";
import {
    AuthRouterComponent,
    GitHubProvider,
    GoogleProvider,
    MemorySessionStore,
    RedisSessionStore,
    UserDeviceRepository,
    UserIdentityRepository,
    UserRepository,
    UserSessionRepository,
} from "@jasonscharf/auth";
import { convosExtension, getConvoService, getConvosInstall } from "@jasonscharf/convos";
import { createDataContext, TripleStore, type SqlLogSink } from "@jasonscharf/data";
import {
    FlowApp,
    HttpDecoder,
    HttpEncoder,
    HttpRouter,
    HttpServer,
    WebSocketServer,
} from "@jasonscharf/flow";
import { buildServerContext, getRbacService, rbacExtension } from "@jasonscharf/server";
import { SecretsManager } from "@jasonscharf/vaults";
import { PinoLogger } from "@jasonscharf/telemetry";
import { MessageDecoder } from "./components/MessageDecoder.js";
import { MessageEncoder } from "./components/MessageEncoder.js";
import { MessageRouter } from "./components/MessageRouter.js";
import { mountDiscussionsRoutes } from "./routes/discussions.js";

function loadVersion(): unknown {
    try {
        return JSON.parse(readFileSync(new URL("../version.json", import.meta.url), "utf8"));
    } catch {
        return { error: "version.json not available — run yarn build" };
    }
}

const VERSION = loadVersion();

const WS_PORT = Number(process.env.PORT ?? 8080);
const HTTP_PORT = Number(process.env.AUTH_PORT ?? 8081);
const BASE_URL = process.env.AUTH_BASE_URL ?? `http://localhost:${HTTP_PORT}`;
const CONFIG = resolve(fileURLToPath(new URL("../config/app.yaml", import.meta.url)));

async function main(): Promise<void> {
    const logger = new PinoLogger("sandbox-server");

    // ── Secrets ───────────────────────────────────────────────────────────────
    // Azure Key Vault when AZURE_KEY_VAULT_URI is set; process.env otherwise.
    const secrets = SecretsManager.fromEnvironment();

    // ── Data layer ────────────────────────────────────────────────────────────
    const dbClient = (await secrets.getWithDefault(
        "TERN_DB_CLIENT",
        process.env.TERN_DB_CLIENT ?? "sqlite",
    )) as "sqlite" | "pg";

    const sqlSink: SqlLogSink = (line) => logger.debug(line);

    let knex: Awaited<ReturnType<typeof createDataContext>>;
    if (dbClient === "pg") {
        knex = await createDataContext(
            {
                client: "pg",
                host: await secrets.getWithDefault(
                    "TERN_PG_HOST",
                    process.env.TERN_PG_HOST ?? "localhost",
                ),
                port: Number(
                    await secrets.getWithDefault("TERN_PG_PORT", process.env.TERN_PG_PORT ?? "5432"),
                ),
                database: await secrets.getWithDefault(
                    "TERN_PG_DATABASE",
                    process.env.TERN_PG_DATABASE ?? "tern",
                ),
                user: await secrets.getWithDefault("TERN_PG_USER", process.env.TERN_PG_USER ?? "tern"),
                password: await secrets.getRequired("TERN_PG_PASSWORD"),
            },
            sqlSink,
        );
        logger.info("DB: PostgreSQL");
    } else {
        const dbPath = await secrets.getWithDefault(
            "TERN_DB_PATH",
            process.env.TERN_DB_PATH ?? ":memory:",
        );
        knex = await createDataContext({ client: "sqlite", filename: dbPath }, sqlSink);
        logger.info("DB: SQLite", { path: dbPath });
    }

    const store = new TripleStore(knex);
    await store.ensureNamespace(buildServerContext(store), "tern", "urn:sys:");
    await store.ensureNamespace(
        buildServerContext(store),
        "rdf",
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    );
    await store.ensureNamespace(
        buildServerContext(store),
        "rdfs",
        "http://www.w3.org/2000/01/rdf-schema#",
    );
    await store.ensureNamespace(buildServerContext(store), "auth", "urn:sys:core:auth:");

    // ── Session store ─────────────────────────────────────────────────────────
    const redisUrl = await secrets.getWithDefault("REDIS_URL", process.env.REDIS_URL ?? "");
    let sessionStore: MemorySessionStore | RedisSessionStore;
    if (redisUrl) {
        const { Redis: RedisClient } = await import("ioredis");
        sessionStore = new RedisSessionStore(new RedisClient(redisUrl));
        logger.info("Session store: Redis", { url: redisUrl });
    } else {
        sessionStore = new MemorySessionStore();
        logger.info("Session store: in-memory (dev only)");
    }

    // ── Auth repositories ─────────────────────────────────────────────────────
    const users = new UserRepository(store);
    const identities = new UserIdentityRepository(store);
    const sessions = new UserSessionRepository(store);
    const devices = new UserDeviceRepository(store);

    // ── OAuth provider credentials (from vault or env) ────────────────────────
    const googleClientId = await secrets.getWithDefault(
        "SYS_AUTH_GOOGLE_CLIENT_ID",
        "placeholder_google_client_id",
    );
    const googleClientSecret = await secrets.getWithDefault(
        "SYS_AUTH_GOOGLE_CLIENT_SECRET",
        "placeholder_google_client_secret",
    );
    const githubClientId = await secrets.getWithDefault(
        "SYS_AUTH_GITHUB_CLIENT_ID",
        "placeholder_github_client_id",
    );
    const githubClientSecret = await secrets.getWithDefault(
        "SYS_AUTH_GITHUB_CLIENT_SECRET",
        "placeholder_github_client_secret",
    );

    // ── Application config + infrastructure extensions ───────────────────────
    const ternApp = await TernApp.fromYAML(CONFIG, { context: { store }, logger });
    const rbacInstalled = await ternApp.use(rbacExtension);
    const convosInstalled = await ternApp.use(convosExtension);
    const rbac = getRbacService(rbacInstalled);
    const convos = getConvoService(convosInstalled);
    const convosInstall = getConvosInstall(convosInstalled);
    logger.info("Loaded app config", {
        name: ternApp.config.name,
        version: ternApp.config.version ?? "?",
    });
    logger.debug("Registered handler types", { types: ternApp.registry.registeredTypes });

    // ── Shared FBP app ────────────────────────────────────────────────────────
    const flowApp = new FlowApp({ mode: "push" });

    // ── Auth router ───────────────────────────────────────────────────────────
    const authRouter = new AuthRouterComponent({
        name: "auth",
        context: flowApp.context,
        providers: [
            new GoogleProvider(googleClientId, googleClientSecret),
            new GitHubProvider(githubClientId, githubClientSecret),
        ],
        sessionStore,
        users,
        identities,
        sessions,
        devices,
        baseUrl: BASE_URL,
        loginSuccess: "/",
        loginFailure: "/auth/error",
    });

    // ── HTTP pipeline ─────────────────────────────────────────────────────────
    const httpServer = new HttpServer({ name: "http", context: flowApp.context, port: HTTP_PORT });
    const httpDecoder = new HttpDecoder({ name: "httpDec", context: flowApp.context });
    const httpEncoder = new HttpEncoder({ name: "httpEnc", context: flowApp.context });
    const topRouter = new HttpRouter({ name: "top", context: flowApp.context });

    topRouter.use(async (ctx, next) => {
        // TODO: Why was this injected by Claude? Cargo-culting?
        ctx.headers["access-control-allow-origin"] = "*";
        ctx.headers["access-control-allow-headers"] = "Authorization, Content-Type";
        ctx.headers["access-control-allow-methods"] = "GET, POST, OPTIONS";
        if (ctx.method === "OPTIONS") {
            ctx.status = 204;
            ctx.body = null;
            return;
        }
        await next();
    });

    topRouter.get("/", async (ctx) => {
        ctx.body = { ok: true, server: "tern-sandbox", wsPort: WS_PORT };
    });

    topRouter.get("/version", async (ctx) => {
        ctx.body = VERSION;
    });

    topRouter.mount("/auth", authRouter.httpRouter);

    mountDiscussionsRoutes(topRouter, convos, rbac, authRouter, convosInstall.userRoleIri, logger);

    flowApp
        .addComponent(httpServer)
        .addComponent(httpDecoder)
        .addComponent(topRouter)
        .addComponent(httpEncoder)
        .addComponent(authRouter)
        .connect(httpServer.requests, httpDecoder.requestIn)
        .connect(httpDecoder.requestOut, topRouter.requests)
        .connect(topRouter.responses, httpEncoder.responseIn)
        .connect(httpEncoder.responseOut, httpServer.responses);

    // ── WebSocket pipeline ────────────────────────────────────────────────────
    const wsServer = new WebSocketServer({ name: "ws", context: flowApp.context, port: WS_PORT });
    const decoder = new MessageDecoder({ name: "decoder", context: flowApp.context });
    const router = new MessageRouter({
        name: "router",
        context: flowApp.context,
        dispatcher: ternApp.registry,
        handlerContext: { store },
    });
    const encoder = new MessageEncoder({ name: "encoder", context: flowApp.context });

    flowApp
        .addComponent(wsServer)
        .addComponent(decoder)
        .addComponent(router)
        .addComponent(encoder)
        .connect(wsServer.received, decoder.in)
        .connect(decoder.out, router.in)
        .connect(router.out, encoder.in)
        .connect(encoder.out, wsServer.send);

    await flowApp.start();
    flowApp.scheduler.start();

    logger.info("WS server ready", { port: WS_PORT });
    logger.info("HTTP server ready", { port: HTTP_PORT });

    process.once("SIGINT", async () => {
        logger.info("Shutting down");
        await flowApp.stop();
        await secrets.close();
        await knex.destroy();
        process.exit(0);
    });
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
