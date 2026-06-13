import type { HttpResponseDraft, ParsedHttpRequest } from "@jasonscharf/flow";
import {
    FlowComponent,
    type FlowComponentOptions,
    type FlowPort,
    type HttpMiddlewareFn,
    HttpRouter,
    wire,
} from "@jasonscharf/flow";
import {
    anonymousSec,
    buildServerContext,
    type SecurityContext,
    systemSec,
} from "@jasonscharf/server";
import { AuthService } from "../AuthService.js";
import {
    AUTH_TRUSTED_PROXIES,
    OAUTH_STATE_COOKIE,
    SESSION_COOKIE,
    SESSION_TTL_SECS,
} from "../constants.js";
import type { IOAuthProvider } from "../oauth/types.js";
import type { LoginAttemptRepository } from "../repository/LoginAttemptRepository.js";
import type { UserDeviceRepository } from "../repository/UserDeviceRepository.js";
import type { UserIdentityRepository } from "../repository/UserIdentityRepository.js";
import type { UserRepository } from "../repository/UserRepository.js";
import type { UserSessionRepository } from "../repository/UserSessionRepository.js";
import { AuthThrottle } from "../session/AuthThrottle.js";
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
    /** Optional. When provided, login attempts are recorded for audit (TRN-171). */
    attempts?: LoginAttemptRepository;
    /** Base URL of this server, e.g. http://localhost:3000 */
    baseUrl: string;
    /** Where to redirect after successful login (default: '/'). */
    loginSuccess?: string;
    /** Where to redirect on login failure (default: '/auth/error'). */
    loginFailure?: string;
    /**
     * IP allowlist of trusted reverse proxies. Only when the socket peer is in
     * this list is x-forwarded-for honored. Defaults to AUTH_TRUSTED_PROXIES.
     */
    trustedProxies?: string[];
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
    private readonly _throttle: AuthThrottle;
    private readonly _trustedProxies: Set<string>;

    constructor(options: AuthRouterOptions) {
        super(options);
        this.requests = this.addPort<ParsedHttpRequest>("requests", "in");
        this.responses = this.addPort<HttpResponseDraft>("responses", "out");

        this._baseUrl = options.baseUrl.replace(/\/$/, "");
        this._success = options.loginSuccess ?? "/";
        this._failure = options.loginFailure ?? "/auth/error";
        this._secure = this._baseUrl.startsWith("https://");
        this._throttle = new AuthThrottle(options.sessionStore);
        this._trustedProxies = new Set(options.trustedProxies ?? AUTH_TRUSTED_PROXIES);

        this._service = new AuthService({
            providers: options.providers,
            sessionStore: options.sessionStore,
            users: options.users,
            identities: options.identities,
            sessions: options.sessions,
            devices: options.devices,
            attempts: options.attempts,
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
        return this._service.validateToken(buildServerContext(this._service.store), systemSec, {
            token,
        });
    }

    /**
     * Resolves the caller's IP for throttling/audit. x-forwarded-for is only
     * honored when the socket peer is a configured trusted proxy; otherwise the
     * socket peer address is used. This prevents trivial per-IP-throttle bypass
     * by spoofing the header. When the socket peer is unknown (e.g. some test
     * transports) the leftmost XFF entry is used as a best-effort fallback.
     */
    private _clientIp(req: ParsedHttpRequest): string | null {
        const peer = req.remoteAddress ?? null;
        const xffRaw = req.headers["x-forwarded-for"];
        const xff = Array.isArray(xffRaw) ? xffRaw[0] : xffRaw;
        const firstXff = xff ? (xff.split(",")[0]?.trim() ?? null) : null;

        if (peer) {
            if (this._trustedProxies.has(peer) && firstXff) {
                return firstXff;
            }
            return peer;
        }
        // No socket peer available — fall back to XFF only if proxies are configured.
        return this._trustedProxies.size > 0 ? firstXff : null;
    }

    /**
     * Koa-style session middleware for use with external HttpRouters.
     * Resolves the session cookie / Bearer token, attaches `ctx.user` and
     * `ctx.sec` (SecurityContext) for use by downstream route handlers.
     */
    sessionMiddleware(): HttpMiddlewareFn {
        return async (ctx, next) => {
            const token =
                getCookie(ctx.req.headers as Record<string, string | undefined>, SESSION_COOKIE) ??
                getBearer(ctx.req.headers as Record<string, string | undefined>);

            if (token) {
                const user = await this._service.validateToken(
                    buildServerContext(this._service.store),
                    systemSec,
                    {
                        token,
                    },
                );
                if (user) {
                    const sessions = await this._service.listSessions(
                        buildServerContext(this._service.store),
                        systemSec,
                        { userId: user.id },
                    );
                    const session = sessions.find((s) => s.sessionToken === token && s.isActive);
                    ctx.user = user;
                    ctx.sec = session
                        ? AuthService.buildSecurityContext({ user, session })
                        : (anonymousSec as SecurityContext);
                    await next();
                    return;
                }
            }

            ctx.sec = anonymousSec as SecurityContext;
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

            const user = await this._service.validateToken(
                buildServerContext(this._service.store),
                systemSec,
                {
                    token,
                },
            );
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

            const user = await this._service.validateToken(
                buildServerContext(this._service.store),
                systemSec,
                {
                    token,
                },
            );
            if (!user) {
                ctx.unauthorized();
                return;
            }

            const sessions = await this._service.listSessions(
                buildServerContext(this._service.store),
                systemSec,
                {
                    userId: user.id,
                },
            );
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
            const token =
                getCookie(ctx.req.headers as Record<string, string | undefined>, SESSION_COOKIE) ??
                getBearer(ctx.req.headers as Record<string, string | undefined>);

            if (token) {
                await this._service.revokeToken(
                    buildServerContext(this._service.store),
                    systemSec,
                    { token },
                );
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

            const user = await this._service.validateToken(
                buildServerContext(this._service.store),
                systemSec,
                {
                    token,
                },
            );
            if (!user) {
                ctx.unauthorized();
                return;
            }

            const revoked = await this._service.revokeAllSessions(
                buildServerContext(this._service.store),
                systemSec,
                {
                    userId: user.id,
                },
            );

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

            // Begin route has no identity to bind to — throttle per IP only.
            const ip = this._clientIp(ctx.req);
            if (await this._throttled(ctx, { ip })) {
                return;
            }

            const redirectUri = `${this._baseUrl}/auth/${prov}/callback`;
            const { url, state } = this._service.buildAuthUrl(prov as OAuthProvider, redirectUri);

            ctx.status = 302;
            ctx.headers.location = url;
            ctx.headers["set-cookie"] = cookieSet(OAUTH_STATE_COOKIE, state, 600, this._secure);
            ctx.body = null;
        });

        // ── GET /auth/:provider/callback ──────────────────────────────────────
        this.httpRouter.get("/auth/:provider/callback", async (ctx) => {
            const prov = ctx.params.provider as OAuthProvider;
            const code = ctx.query.get("code") ?? "";
            const state = ctx.query.get("state") ?? "";
            const savedState = getCookie(
                ctx.req.headers as Record<string, string | undefined>,
                OAUTH_STATE_COOKIE,
            );

            const ua = (() => {
                const h = ctx.req.headers["user-agent"];
                return Array.isArray(h) ? h[0] : (h ?? undefined);
            })();
            const ip = this._clientIp(ctx.req);

            // Throttle every callback hit (keyed by IP and by provider+state) so
            // the unauthenticated callback path cannot be hammered.
            if (await this._throttled(ctx, { ip, identity: `cb:${prov}:${state}` })) {
                return;
            }

            if (!code || !savedState || savedState !== state) {
                // State mismatch / missing code is a rejected (possibly forged)
                // login — record it for the audit trail.
                await this._service.recordAttempt({
                    provider: prov,
                    status: "error",
                    nonce: state || null,
                    ipAddress: ip,
                    userAgent: ua,
                    errorCode: "state_mismatch",
                });
                ctx.status = 302;
                ctx.headers.location = this._failure;
                ctx.body = null;
                return;
            }

            try {
                const { session } = await this._service.handleCallback({
                    provider: prov,
                    code,
                    redirectUri: `${this._baseUrl}/auth/${prov}/callback`,
                    device: { userAgent: ua, platform: "web" },
                    ipAddress: ip ?? undefined,
                    nonce: state,
                });

                ctx.status = 302;
                ctx.headers.location = this._success;
                ctx.headers["set-cookie"] = [
                    cookieSet(SESSION_COOKIE, session.sessionToken, SESSION_TTL_SECS, this._secure),
                    cookieClear(OAUTH_STATE_COOKIE),
                ];
                ctx.body = null;
            } catch {
                // handleCallback already recorded the failure attempt.
                ctx.status = 302;
                ctx.headers.location = this._failure;
                ctx.body = null;
            }
        });
    }

    /**
     * Runs the throttle for one request. When over a limit, writes a 429 to the
     * response and returns true so the caller can short-circuit.
     */
    private async _throttled(
        ctx: { status: number; headers: Record<string, string | string[]>; body: unknown },
        args: { ip: string | null; identity?: string | null },
    ): Promise<boolean> {
        const { allowed, retryAfterSecs } = await this._throttle.check(args);
        if (allowed) {
            return false;
        }
        ctx.status = 429;
        ctx.headers["retry-after"] = String(retryAfterSecs);
        ctx.body = { error: "Too Many Requests" };
        return true;
    }
}
