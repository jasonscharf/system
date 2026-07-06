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
import { SystemApp } from "@jasonscharf/app";
import {
    AuthRouterComponent,
    GitHubProvider,
    GoogleProvider,
    MemorySessionStore,
    RedisSessionStore,
    SessionStore,
    UserDeviceRepository,
    UserIdentityRepository,
    UserRepository,
    UserSessionRepository,
} from "@jasonscharf/auth";
import { convosExtension, getConvoService, getConvosInstall } from "@jasonscharf/convos";
import { bindService } from "@jasonscharf/core";
import { createDataContext, DataSource, TripleStore } from "@jasonscharf/data";
import {
    FlowApp,
    HttpDecoder,
    HttpEncoder,
    HttpRouter,
    HttpServer,
    WebSocketServer,
} from "@jasonscharf/flow";
import {
    buildServerContext,
    FieldCipherService,
    getRbacService,
    rbacExtension,
} from "@jasonscharf/server";
import { FieldCipher, SecretsManager } from "@jasonscharf/vaults";
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
    // ── Secrets ───────────────────────────────────────────────────────────────
    // Azure Key Vault when AZURE_KEY_VAULT_URI is set; process.env otherwise.
    const secrets = SecretsManager.fromEnvironment();

    // ── Data layer ────────────────────────────────────────────────────────────
    const dbClient = (await secrets.getWithDefault(
        "SYS_DB_CLIENT",
        process.env.SYS_DB_CLIENT ?? "sqlite",
    )) as "sqlite" | "pg";

    let knex: Awaited<ReturnType<typeof createDataContext>>;
    if (dbClient === "pg") {
        knex = await createDataContext({
            client: "pg",
            host: await secrets.getWithDefault(
                "SYS_PG_HOST",
                process.env.SYS_PG_HOST ?? "localhost",
            ),
            port: Number(
                await secrets.getWithDefault("SYS_PG_PORT", process.env.SYS_PG_PORT ?? "5432"),
            ),
            database: await secrets.getWithDefault(
                "SYS_PG_DATABASE",
                process.env.SYS_PG_DATABASE ?? "system",
            ),
            user: await secrets.getWithDefault("SYS_PG_USER", process.env.SYS_PG_USER ?? "tern"),
            password: await secrets.getRequired("SYS_PG_PASSWORD"),
        });
        console.log("[sandbox-server] DB: PostgreSQL");
    } else {
        const dbPath = await secrets.getWithDefault(
            "SYS_DB_PATH",
            process.env.SYS_DB_PATH ?? ":memory:",
        );
        knex = await createDataContext({ client: "sqlite", filename: dbPath });
        console.log(`[sandbox-server] DB: SQLite (${dbPath})`);
    }

    const store = new TripleStore(knex);
    bindService(DataSource, new DataSource(knex));
    bindService(TripleStore, store);
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
        console.log(`[sandbox-server] Session store: Redis (${redisUrl})`);
    } else {
        sessionStore = new MemorySessionStore();
        console.log("[sandbox-server] Session store: in-memory (dev only)");
    }

    // ── Field cipher (at-rest PII) ────────────────────────────────────────────
    // Closes TRN-169: OAuth access/refresh tokens and user display name / avatar
    // are encrypted at rest.  Key material is read from the SecretsManager
    // (vault > env), so SYS_FIELD_ENC_KEYS (JSON keyId->base64 key) and
    // SYS_FIELD_ENC_CURRENT (active key id) must be configured.  We fail closed:
    // if no key is configured the server refuses to start rather than silently
    // persisting PII as cleartext.
    let cipher: FieldCipher;
    try {
        cipher = await FieldCipher.fromSecrets(secrets);
    } catch (err) {
        throw new Error(
            "[sandbox-server] Field encryption key is not configured. Set SYS_FIELD_ENC_KEYS " +
                "(JSON keyId->base64 32-byte key) and SYS_FIELD_ENC_CURRENT (active key id) in the " +
                `vault or environment. Encryption of at-rest PII cannot be disabled. Cause: ${err}`,
        );
    }
    console.log("[sandbox-server] Field cipher: enabled (at-rest PII encryption)");
    bindService(FieldCipherService, cipher);

    // ── Auth services → IoC container ─────────────────────────────────────────
    // Components (AuthRouterComponent and children) resolve these from the
    // container; nothing threads them through options any more.
    bindService(SessionStore, sessionStore);
    bindService(UserRepository, new UserRepository(store, cipher));
    bindService(UserIdentityRepository, new UserIdentityRepository(store, cipher));
    bindService(UserSessionRepository, new UserSessionRepository(store));
    bindService(UserDeviceRepository, new UserDeviceRepository(store));

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
    const ternApp = await SystemApp.fromYAML(CONFIG, { context: { store } });
    const rbacInstalled = await ternApp.use(rbacExtension);
    const convosInstalled = await ternApp.use(convosExtension);
    const rbac = getRbacService(rbacInstalled);
    const convos = getConvoService(convosInstalled);
    const convosInstall = getConvosInstall(convosInstalled);
    console.log(
        `[sandbox-server] Loaded: ${ternApp.config.name} v${ternApp.config.version ?? "?"}`,
    );
    console.log(`[sandbox-server] Handlers: ${ternApp.registry.registeredTypes.join(", ")}`);

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

    mountDiscussionsRoutes(topRouter, convos, rbac, authRouter, convosInstall.userRoleIri);

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

    console.log(`[sandbox-server] WS   → ws://0.0.0.0:${WS_PORT}`);
    console.log(`[sandbox-server] HTTP → http://0.0.0.0:${HTTP_PORT}`);

    process.once("SIGINT", async () => {
        console.log("\n[sandbox-server] Shutting down…");
        await flowApp.stop();
        await secrets.close();
        await knex.destroy();
        process.exit(0);
    });
}

main().catch((err) => {
    console.error("[sandbox-server] Fatal:", err);
    process.exit(1);
});
