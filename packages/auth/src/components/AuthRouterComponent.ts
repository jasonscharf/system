import { FlowComponent, HttpRouter, type FlowComponentOptions, type HttpMiddlewareFn } from '@system/flow';
import { FlowPort } from '@system/flow';
import type { ParsedHttpRequest, HttpResponseDraft } from '@system/flow';
import { AuthService } from '../AuthService.js';
import { OAuthComponent } from './OAuthComponent.js';
import { CallbackComponent } from './CallbackComponent.js';
import { SessionComponent } from './SessionComponent.js';
import { SESSION_COOKIE, OAUTH_STATE_COOKIE, SESSION_TTL_SECS } from '../constants.js';
import type { IOAuthProvider } from '../oauth/types.js';
import type { ISessionStore } from '../session/ISessionStore.js';
import type { UserRepository } from '../repository/UserRepository.js';
import type { UserIdentityRepository } from '../repository/UserIdentityRepository.js';
import type { UserSessionRepository } from '../repository/UserSessionRepository.js';
import type { UserDeviceRepository } from '../repository/UserDeviceRepository.js';
import type { OAuthProvider, UserEntity } from '../types.js';


export interface AuthRouterOptions extends FlowComponentOptions {
    providers:    IOAuthProvider[];
    sessionStore: ISessionStore;
    users:        UserRepository;
    identities:   UserIdentityRepository;
    sessions:     UserSessionRepository;
    devices:      UserDeviceRepository;
    /** Base URL of this server, e.g. http://localhost:3000 */
    baseUrl:      string;
    /** Where to redirect after successful login (default: '/'). */
    loginSuccess?: string;
    /** Where to redirect on login failure (default: '/auth/error'). */
    loginFailure?: string;
}

// ── Cookie helpers ────────────────────────────────────────────────────────────

function parseCookies(header: string): Record<string, string> {
    return Object.fromEntries(
        header.split(';').map(part => {
            const eq = part.indexOf('=');
            return eq < 0
                ? [part.trim(), '']
                : [part.slice(0, eq).trim(), decodeURIComponent(part.slice(eq + 1).trim())];
        }),
    );
}

function cookieSet(name: string, value: string, maxAge: number): string {
    return `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Path=/`;
}

function cookieClear(name: string): string {
    return `${name}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/`;
}

function getCookie(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
    const raw = headers['cookie'];
    const str = Array.isArray(raw) ? raw[0] : raw;
    if (!str) { return undefined; }
    return parseCookies(str)[name];
}

function getBearer(headers: Record<string, string | string[] | undefined>): string | undefined {
    const auth = headers['authorization'];
    const str  = Array.isArray(auth) ? auth[0] : auth;
    return str?.replace(/^Bearer\s+/i, '') || undefined;
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
    readonly requests:  FlowPort<ParsedHttpRequest>;
    readonly responses: FlowPort<HttpResponseDraft>;

    // Expose child components for external FBP pipeline wiring
    readonly oauth:    OAuthComponent;
    readonly callback: CallbackComponent;
    readonly session:  SessionComponent;

    readonly httpRouter: HttpRouter;
    private readonly _service: AuthService;
    private readonly _baseUrl: string;
    private readonly _success: string;
    private readonly _failure: string;

    constructor(options: AuthRouterOptions) {
        super(options);
        this.requests  = this.addPort<ParsedHttpRequest>('requests',  'in');
        this.responses = this.addPort<HttpResponseDraft>('responses', 'out');

        this._baseUrl  = options.baseUrl.replace(/\/$/, '');
        this._success  = options.loginSuccess ?? '/';
        this._failure  = options.loginFailure ?? '/auth/error';

        this._service = new AuthService({
            providers:    options.providers,
            sessionStore: options.sessionStore,
            users:        options.users,
            identities:   options.identities,
            sessions:     options.sessions,
            devices:      options.devices,
        });

        // ── Child FBP components (for standalone pipeline use) ────────────────
        this.oauth = new OAuthComponent({
            name: `${options.name ?? 'auth'}.oauth`,
            context: this.context,
            providers: options.providers,
        });
        this.callback = new CallbackComponent({
            name: `${options.name ?? 'auth'}.callback`,
            context: this.context,
            providers:    options.providers,
            sessionStore: options.sessionStore,
            users:        options.users,
            identities:   options.identities,
            sessions:     options.sessions,
            devices:      options.devices,
        });
        this.session = new SessionComponent({
            name: `${options.name ?? 'auth'}.session`,
            context: this.context,
            sessionStore: options.sessionStore,
            users:        options.users,
            sessions:     options.sessions,
        });
        this.addChild(this.oauth);
        this.addChild(this.callback);
        this.addChild(this.session);

        // ── HTTP router ───────────────────────────────────────────────────────
        this.httpRouter = new HttpRouter({ name: `${options.name ?? 'auth'}.router`, context: this.context });
        this._registerRoutes();
    }

    override step(): void {
        // Forward all inbound HTTP requests to the inner router's input port
        let req: ParsedHttpRequest | undefined;
        while ((req = this.requests.read()) !== undefined) {
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
            const token = getCookie(ctx.req.headers as Record<string, string | undefined>, SESSION_COOKIE)
                ?? getBearer(ctx.req.headers as Record<string, string | undefined>);

            if (token) {
                const user = await this._service.validateToken(token);
                if (user) { ctx['user'] = user; }
            }

            await next();
        };
    }

    private _registerRoutes(): void {
        // Wire router responses to our output port
        this.httpRouter.responses._addTransport({
            deliver: (msg: HttpResponseDraft) => this.responses.put(msg),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        // ── GET /auth/:provider ───────────────────────────────────────────────
        this.httpRouter.get('/auth/:provider', async ctx => {
            const prov = ctx.params['provider'] as OAuthProvider;
            if (prov !== 'google' && prov !== 'github') {
                ctx.notFound(`Unknown provider: ${prov}`); return;
            }

            const redirectUri = `${this._baseUrl}/auth/${prov}/callback`;
            const { url, state } = this._service.buildAuthUrl(prov, redirectUri);

            ctx.status                = 302;
            ctx.headers['location']   = url;
            ctx.headers['set-cookie'] = cookieSet(OAUTH_STATE_COOKIE, state, 600);
            ctx.body                  = null;
        });

        // ── GET /auth/:provider/callback ──────────────────────────────────────
        this.httpRouter.get('/auth/:provider/callback', async ctx => {
            const prov      = ctx.params['provider'] as OAuthProvider;
            const code      = ctx.query.get('code')  ?? '';
            const state     = ctx.query.get('state') ?? '';
            const savedState = getCookie(ctx.req.headers as Record<string, string | undefined>, OAUTH_STATE_COOKIE);

            if (!code || !savedState || savedState !== state) {
                ctx.status = 302; ctx.headers['location'] = this._failure; ctx.body = null; return;
            }

            const ua = (() => {
                const h = ctx.req.headers['user-agent'];
                return Array.isArray(h) ? h[0] : h;
            })();

            const ip = (() => {
                const h = ctx.req.headers['x-forwarded-for'];
                const s = Array.isArray(h) ? h[0] : h;
                return s ? s.split(',')[0].trim() : undefined;
            })();

            try {
                const { session } = await this._service.handleCallback({
                    provider:    prov,
                    code,
                    redirectUri: `${this._baseUrl}/auth/${prov}/callback`,
                    device:      { userAgent: ua, platform: 'web' },
                    ipAddress:   ip,
                });

                ctx.status = 302;
                ctx.headers['location']   = this._success;
                ctx.headers['set-cookie'] = [
                    cookieSet(SESSION_COOKIE, session.sessionToken, SESSION_TTL_SECS),
                    cookieClear(OAUTH_STATE_COOKIE),
                ];
                ctx.body = null;
            } catch {
                ctx.status = 302; ctx.headers['location'] = this._failure; ctx.body = null;
            }
        });

        // ── POST /auth/logout ─────────────────────────────────────────────────
        this.httpRouter.post('/auth/logout', async ctx => {
            const token = getCookie(ctx.req.headers as Record<string, string | undefined>, SESSION_COOKIE);
            if (token) { await this._service.revokeToken(token); }

            ctx.status = 200;
            ctx.headers['set-cookie'] = cookieClear(SESSION_COOKIE);
            ctx.body = { ok: true };
        });

        // ── GET /auth/me ──────────────────────────────────────────────────────
        this.httpRouter.get('/auth/me', async ctx => {
            const token = getCookie(ctx.req.headers as Record<string, string | undefined>, SESSION_COOKIE)
                ?? getBearer(ctx.req.headers as Record<string, string | undefined>);

            if (!token) { ctx.unauthorized(); return; }

            const user = await this._service.validateToken(token);
            if (!user) { ctx.unauthorized(); return; }

            ctx.body = {
                id:          user.id,
                email:       user.email,
                displayName: user.displayName ?? null,
                avatarUrl:   user.avatarUrl   ?? null,
            };
        });
    }
}
