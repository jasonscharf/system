import type { HttpResponseDraft, ParsedHttpRequest } from "@jasonscharf/flow";
import {
    FlowComponent,
    type FlowComponentOptions,
    type FlowPort,
    type HttpMiddlewareFn,
    HttpRouter,
    wire,
} from "@jasonscharf/flow";
import { AuthService } from "../AuthService.js";
import { OAUTH_STATE_COOKIE, SESSION_COOKIE, SESSION_TTL_SECS } from "../constants.js";
import type { IOAuthProvider } from "../oauth/types.js";
import type { UserDeviceRepository } from "../repository/UserDeviceRepository.js";
import type { UserIdentityRepository } from "../repository/UserIdentityRepository.js";
import type { UserRepository } from "../repository/UserRepository.js";
import type { UserSessionRepository } from "../repository/UserSessionRepository.js";
import type { ISessionStore } from "../session/ISessionStore.js";
import type { OAuthProvider, UserEntity } from "../types.js";
import { CallbackComponent } from "./CallbackComponent.js";
import { OAuthComponent } from "./OAuthComponent.js";
import { SessionComponent } from "./SessionComponent.js";

export interface AuthRouterOptions extends FlowComponentOptions {
    providers: IOAuthProvider[];
    sessionStore: ISessionStore;
    users: UserRepository;
    identities: UserIdentityRepository;
    sessions: UserSessionRepository;
    devices: UserDeviceRepository;
    /** Base URL of this server, e.g. http://localhost:3000 */
    baseUrl: string;
    /** Where to redirect after successful login (default: '/'). */
    loginSuccess?: string;
    /** Where to redirect on login failure (default: '/auth/error'). */
    loginFailure?: string;
}

// ── Cookie helpers ────────────────────────────────────────────────────────────

function parseCookies(header: string): Record<string, string> {
    return Object.fromEntries(
        header.split(";").map((part) => {
            const eq = part.indexOf("=");
            return eq < 0
                ? [part.trim(), ""]
                : [part.slice(0, eq).trim(), decodeURIComponent(part.slice(eq + 1).trim())];
        }),
    );
}

function cookieSet(name: string, value: string, maxAge: number, secure: boolean): string {
    const securePart = secure ? "; Secure" : "";
    return `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Path=/${securePart}`;
}

function cookieClear(name: string): string {
    return `${name}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/`;
}

function getCookie(
    headers: Record<string, string | string[] | undefined>,
    name: string,
): string | undefined {
    const raw = headers.cookie;
    const str = Array.isArray(raw) ? raw[0] : raw;
    if (!str) {
        return undefined;
    }
    return parseCookies(str)[name];
}

function getBearer(headers: Record<string, string | string[] | undefined>): string | undefined {
    const auth = headers.authorization;
    const str = Array.isArray(auth) ? auth[0] : auth;
    return str?.replace(/^Bearer\s+/i, "") || undefined;
}

/**
 * Production auth router as a first-class FBP component.
 *
 * Exposes `requests`/`responses` ports compatible with any HttpDecoder →
 * HttpEncoder pipeline. Internally owns OAuthComponent, CallbackComponent,
 * and SessionComponent child components for standalone FBP pipeline use.
 *
 * Routes:
 *   GET  /auth/:provider           — begin OAuth flow (redirect to provider)
 *   GET  /auth/:provider/callback  — handle provider callback, set session cookie
 *   POST /auth/logout              — revoke session, clear cookie
 *   GET  /auth/me                  — return current user as JSON
 */
export class AuthRouterComponent extends FlowComponent {
    readonly requests: FlowPort<ParsedHttpRequest>;
    readonly responses: FlowPort<HttpResponseDraft>;

    // Expose child components for external FBP pipeline wiring
    readonly oauth: OAuthComponent;
    readonly callback: CallbackComponent;
    readonly session: SessionComponent;

    readonly httpRouter: HttpRouter;
    private readonly _service: AuthService;
    private readonly _baseUrl: string;
    private readonly _success: string;
    private readonly _failure: string;
    /** Set automatically when baseUrl starts with https:// — adds Secure to session cookies. */
    private readonly _secure: boolean;

    constructor(options: AuthRouterOptions) {
        super(options);
        this.requests = this.addPort<ParsedHttpRequest>("requests", "in");
        this.responses = this.addPort<HttpResponseDraft>("responses", "out");

        this._baseUrl = options.baseUrl.replace(/\/$/, "");
        this._success = options.loginSuccess ?? "/";
        this._failure = options.loginFailure ?? "/auth/error";
        this._secure = this._baseUrl.startsWith("https://");

        this._service = new AuthService({
            providers: options.providers,
            sessionStore: options.sessionStore,
            users: options.users,
            identities: options.identities,
            sessions: options.sessions,
            devices: options.devices,
        });

        // ── Child FBP components (for standalone pipeline use) ────────────────
        this.oauth = new OAuthComponent({
            name: `${options.name ?? "auth"}.oauth`,
            context: this.context,
            providers: options.providers,
        });
        this.callback = new CallbackComponent({
            name: `${options.name ?? "auth"}.callback`,
            context: this.context,
            providers: options.providers,
            sessionStore: options.sessionStore,
            users: options.users,
            identities: options.identities,
            sessions: options.sessions,
            devices: options.devices,
        });
        this.session = new SessionComponent({
            name: `${options.name ?? "auth"}.session`,
            context: this.context,
            sessionStore: options.sessionStore,
            users: options.users,
            sessions: options.sessions,
        });
        this.addChild(this.oauth);
        this.addChild(this.callback);
        this.addChild(this.session);

        // ── HTTP router ───────────────────────────────────────────────────────
        this.httpRouter = new HttpRouter({
            name: `${options.name ?? "auth"}.router`,
            context: this.context,
        });
        this._registerRoutes();
    }

    override step(): void {
        // Forward all inbound HTTP requests to the inner router's input port
        for (;;) {
            const req = this.requests.read();
            if (req === undefined) {
                break;
            }
            this.httpRouter.requests.put(req);
        }
        // Process the inner router (async handlers fire and deliver to _router.responses,
        // which the transport above re-routes to this.responses)
        this.httpRouter.step();
        this.oauth.step();
        this.callback.step();
        this.session.step();
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Validates a session token from any transport (HTTP cookie, WS header,
     * Bearer token).  Returns the user entity or null.
     */
    validateToken(token: string): Promise<UserEntity | null> {
        return this._service.validateToken(token);
    }

    /**
     * Koa-style session middleware for use with external HttpRouters.
     * Resolves the session cookie / Bearer token and attaches `ctx.user`.
     */
    sessionMiddleware(): HttpMiddlewareFn {
        return async (ctx, next) => {
            const token =
                getCookie(ctx.req.headers as Record<string, string | undefined>, SESSION_COOKIE) ??
                getBearer(ctx.req.headers as Record<string, string | undefined>);

            if (token) {
                const user = await this._service.validateToken(token);
                if (user) {
                    ctx.user = user;
                }
            }

            await next();
        };
    }

    private _registerRoutes(): void {
        // Wire router responses to our output port
        wire(this.httpRouter.responses, this.responses);

        // ── GET /auth/me ──────────────────────────────────────────────────────
        this.httpRouter.get("/auth/me", async (ctx) => {
            const token =
                getCookie(ctx.req.headers as Record<string, string | undefined>, SESSION_COOKIE) ??
                getBearer(ctx.req.headers as Record<string, string | undefined>);

            if (!token) {
                ctx.unauthorized();
                return;
            }

            const user = await this._service.validateToken(token);
            if (!user) {
                ctx.unauthorized();
                return;
            }

            ctx.body = {
                id: user.id,
                email: user.email,
                displayName: user.displayName ?? null,
                avatarUrl: user.avatarUrl ?? null,
            };
        });

        // ── GET /auth/sessions — list this user's sessions ────────────────────
        this.httpRouter.get("/auth/sessions", async (ctx) => {
            const token =
                getCookie(ctx.req.headers as Record<string, string | undefined>, SESSION_COOKIE) ??
                getBearer(ctx.req.headers as Record<string, string | undefined>);

            if (!token) {
                ctx.unauthorized();
                return;
            }

            const user = await this._service.validateToken(token);
            if (!user) {
                ctx.unauthorized();
                return;
            }

            const sessions = await this._service.listSessions(user.id);
            ctx.body = sessions.map((s) => ({
                id: s.id,
                isActive: s.isActive,
                expiresAt: s.expiresAt,
                createdAt: s.createdAt,
                ipAddress: s.ipAddress ?? null,
            }));
        });

        // ── POST /auth/logout — revoke current session ────────────────────────
        this.httpRouter.post("/auth/logout", async (ctx) => {
            // Accept both cookie (browser) and Bearer (mobile / API)
            const token =
                getCookie(ctx.req.headers as Record<string, string | undefined>, SESSION_COOKIE) ??
                getBearer(ctx.req.headers as Record<string, string | undefined>);

            if (token) {
                await this._service.revokeToken(token);
            }

            ctx.status = 200;
            ctx.headers["set-cookie"] = cookieClear(SESSION_COOKIE);
            ctx.body = { ok: true };
        });

        // ── POST /auth/logout/all — revoke every session for this user ────────
        this.httpRouter.post("/auth/logout/all", async (ctx) => {
            const token =
                getCookie(ctx.req.headers as Record<string, string | undefined>, SESSION_COOKIE) ??
                getBearer(ctx.req.headers as Record<string, string | undefined>);

            if (!token) {
                ctx.unauthorized();
                return;
            }

            const user = await this._service.validateToken(token);
            if (!user) {
                ctx.unauthorized();
                return;
            }

            const revoked = await this._service.revokeAllSessions(user.id);

            ctx.status = 200;
            ctx.headers["set-cookie"] = cookieClear(SESSION_COOKIE);
            ctx.body = { ok: true, revoked };
        });

        // ── GET /auth/:provider ───────────────────────────────────────────────
        this.httpRouter.get("/auth/:provider", async (ctx) => {
            const prov = ctx.params.provider ?? "";
            if (!this._service.hasProvider(prov)) {
                ctx.notFound(`Unknown provider: ${prov}`);
                return;
            }

            const redirectUri = `${this._baseUrl}/auth/${prov}/callback`;
            const { url, state } = this._service.buildAuthUrl(prov as OAuthProvider, redirectUri);

            ctx.status = 302;
            ctx.headers.location = url;
            ctx.headers["set-cookie"] = cookieSet(OAUTH_STATE_COOKIE, state, 600, this._secure);
            ctx.body = null;
        });

        // TODO: Should be POST
        // ── GET /auth/:provider/callback ──────────────────────────────────────
        this.httpRouter.get("/auth/:provider/callback", async (ctx) => {
            const prov = ctx.params.provider as OAuthProvider;
            const code = ctx.query.get("code") ?? "";
            const state = ctx.query.get("state") ?? "";
            const savedState = getCookie(
                ctx.req.headers as Record<string, string | undefined>,
                OAUTH_STATE_COOKIE,
            );

            if (!code || !savedState || savedState !== state) {
                ctx.status = 302;
                ctx.headers.location = this._failure;
                ctx.body = null;
                return;
            }

            const ua = (() => {
                const h = ctx.req.headers["user-agent"];
                return Array.isArray(h) ? h[0] : (h ?? undefined);
            })();

            const ip = (() => {
                const h = ctx.req.headers["x-forwarded-for"];
                const s = Array.isArray(h) ? h[0] : h;
                return s ? s.split(",")[0]?.trim() : undefined;
            })();

            try {
                const { session } = await this._service.handleCallback({
                    provider: prov,
                    code,
                    redirectUri: `${this._baseUrl}/auth/${prov}/callback`,
                    device: { userAgent: ua, platform: "web" },
                    ipAddress: ip,
                });

                ctx.status = 302;
                ctx.headers.location = this._success;
                ctx.headers["set-cookie"] = [
                    cookieSet(SESSION_COOKIE, session.sessionToken, SESSION_TTL_SECS, this._secure),
                    cookieClear(OAUTH_STATE_COOKIE),
                ];
                ctx.body = null;
            } catch {
                ctx.status = 302;
                ctx.headers.location = this._failure;
                ctx.body = null;
            }
        });
    }
}
