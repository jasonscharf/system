import { randomBytes } from "node:crypto";
import { makeUri, NS_CORE } from "@jasonscharf/core";
import {
    anonymousSec,
    buildServerContext,
    type SecurityContext,
    type ServerContext,
    systemSec,
} from "@jasonscharf/server";
import { AUTH_NEG_CACHE_TTL_SECS, NEG_CACHE_SENTINEL, SESSION_TTL_SECS } from "./constants.js";
import type { IOAuthProvider } from "./oauth/types.js";
import type { LoginAttemptRepository } from "./repository/LoginAttemptRepository.js";
import type { UserDeviceRepository } from "./repository/UserDeviceRepository.js";
import type { UserIdentityRepository } from "./repository/UserIdentityRepository.js";
import type { UserRepository } from "./repository/UserRepository.js";
import type { UserSessionRepository } from "./repository/UserSessionRepository.js";
import { hashSessionToken } from "./repository/util.js";
import type { ISessionStore } from "./session/ISessionStore.js";
import type {
    DeviceInfo,
    LoginAttemptStatus,
    OAuthProvider,
    UserEntity,
    UserSessionEntity,
} from "./types.js";

export interface LoginResult {
    user: UserEntity;
    session: UserSessionEntity;
}

export interface TokenArgs {
    token: string;
}

export interface UserIdArgs {
    userId: string;
}

/**
 * Core auth business logic — provider-agnostic, transport-agnostic.
 * Used directly by HTTP/WS handlers and wrapped by FBP components.
 */
export class AuthService {
    private readonly _providers: Map<OAuthProvider, IOAuthProvider>;
    private readonly _store: ISessionStore;
    private readonly _users: UserRepository;
    private readonly _identities: UserIdentityRepository;
    private readonly _sessions: UserSessionRepository;
    private readonly _devices: UserDeviceRepository;
    private readonly _attempts: LoginAttemptRepository | null;

    constructor(opts: {
        providers: IOAuthProvider[];
        sessionStore: ISessionStore;
        users: UserRepository;
        identities: UserIdentityRepository;
        sessions: UserSessionRepository;
        devices: UserDeviceRepository;
        /** Optional. When provided, login attempts are recorded for audit. */
        attempts?: LoginAttemptRepository;
    }) {
        this._providers = new Map(opts.providers.map((p) => [p.name, p]));
        this._store = opts.sessionStore;
        this._users = opts.users;
        this._identities = opts.identities;
        this._sessions = opts.sessions;
        this._devices = opts.devices;
        this._attempts = opts.attempts ?? null;
    }

    get store() {
        return this._users.store;
    }

    /**
     * Fast-path session-store (Redis/memory) cache key for a raw token.  The
     * token is hashed first so the raw bearer credential never lands in a cache
     * key either — only its sha256, matching the at-rest representation.
     */
    private _sessionCacheKey(token: string): string {
        return makeUri(NS_CORE, "session", hashSessionToken(token));
    }

    getProvider(name: OAuthProvider): IOAuthProvider {
        const p = this._providers.get(name);
        if (!p) {
            throw new Error(`Unknown OAuth provider: ${name}`);
        }
        return p;
    }

    buildAuthUrl(provider: OAuthProvider, redirectUri: string): { url: string; state: string } {
        const state = randomBytes(16).toString("hex");
        return { url: this.getProvider(provider).getAuthUrl(redirectUri, state), state };
    }

    async handleCallback(opts: {
        provider: OAuthProvider;
        code: string;
        redirectUri: string;
        device: DeviceInfo;
        ipAddress?: string;
        /** OAuth state value, used as the login-attempt nonce for the audit trail. */
        nonce?: string;
    }): Promise<LoginResult> {
        try {
            return await this._handleCallbackInner(opts);
        } catch (err) {
            // Audit the failure, then re-throw so callers keep their existing behavior.
            await this._recordAttempt({
                provider: opts.provider,
                nonce: opts.nonce,
                ipAddress: opts.ipAddress,
                userAgent: opts.device.userAgent,
                status: "error",
                errorCode: err instanceof Error ? err.message : "unknown_error",
            });
            throw err;
        }
    }

    private async _handleCallbackInner(opts: {
        provider: OAuthProvider;
        code: string;
        redirectUri: string;
        device: DeviceInfo;
        ipAddress?: string;
        nonce?: string;
    }): Promise<LoginResult> {
        const { profile, tokens } = await this.getProvider(opts.provider).exchangeCode(
            opts.code,
            opts.redirectUri,
        );

        // All DB writes are atomic within a single transaction.
        const { user, session } = await this._users.store.withTransaction(
            buildServerContext(this._users.store),
            async (ctx) => {
                const sec = systemSec;

                // Upsert user
                let user = await this._users.findByEmail(ctx, sec, { email: profile.email });
                if (!user) {
                    user = await this._users.create(ctx, sec, {
                        email: profile.email,
                        displayName: profile.displayName,
                        avatarUrl: profile.avatarUrl,
                    });
                } else if (profile.displayName || profile.avatarUrl) {
                    user =
                        (await this._users.update(ctx, sec, {
                            id: user.id,
                            patch: {
                                displayName: profile.displayName ?? user.displayName,
                                avatarUrl: profile.avatarUrl ?? user.avatarUrl,
                            },
                        })) ?? user;
                }

                // Upsert identity
                const identity = await this._identities.findByProvider(ctx, sec, {
                    provider: opts.provider,
                    providerUserId: profile.providerUserId,
                });
                if (!identity) {
                    await this._identities.create(ctx, sec, {
                        provider: opts.provider,
                        providerUserId: profile.providerUserId,
                        providerEmail: profile.email,
                        accessToken: tokens.accessToken,
                        refreshToken: tokens.refreshToken,
                        tokenExpiresAt: tokens.expiresAt,
                        userId: user.id,
                    });
                } else {
                    await this._identities.updateTokens(ctx, sec, {
                        id: identity.id,
                        tokens: {
                            accessToken: tokens.accessToken,
                            refreshToken: tokens.refreshToken,
                            tokenExpiresAt: tokens.expiresAt,
                        },
                    });
                }

                // Upsert device and create session
                const device = await this._devices.findOrCreate(ctx, sec, {
                    userId: user.id,
                    info: opts.device,
                });
                const expiresAt = new Date(Date.now() + SESSION_TTL_SECS * 1000);
                const session = await this._sessions.create(ctx, sec, {
                    userId: user.id,
                    deviceId: device.id,
                    expiresAt,
                    ipAddress: opts.ipAddress,
                });

                return { user, session, expiresAt, deviceId: device.id };
            },
        );

        await this._store.set(
            // session.sessionToken here is the raw token returned by create().
            this._sessionCacheKey(session.sessionToken),
            JSON.stringify({
                userId: user.id,
                deviceId: session.deviceId,
                expiresAt: session.expiresAt.getTime(),
            }),
            SESSION_TTL_SECS,
        );

        await this._recordAttempt({
            provider: opts.provider,
            nonce: opts.nonce,
            ipAddress: opts.ipAddress,
            userAgent: opts.device.userAgent,
            status: "success",
            userId: user.id,
        });

        return { user, session };
    }

    /**
     * Records a login attempt for the audit trail. No-op when no
     * LoginAttemptRepository was supplied. A missing nonce is filled with a
     * synthetic value so the audit row is still queryable. Audit failures never
     * break the auth flow — they are swallowed.
     */
    async recordAttempt(args: {
        provider: OAuthProvider;
        status: LoginAttemptStatus;
        nonce?: string | null;
        ipAddress?: string | null;
        userAgent?: string | null;
        userId?: string | null;
        errorCode?: string | null;
    }): Promise<void> {
        await this._recordAttempt(args);
    }

    private async _recordAttempt(args: {
        provider: OAuthProvider;
        status: LoginAttemptStatus;
        nonce?: string | null;
        ipAddress?: string | null;
        userAgent?: string | null;
        userId?: string | null;
        errorCode?: string | null;
    }): Promise<void> {
        if (!this._attempts) {
            return;
        }
        try {
            const ctx = buildServerContext(this._users.store);
            const nonce = args.nonce ?? `synthetic:${randomBytes(8).toString("hex")}`;
            const created = await this._attempts.create(ctx, systemSec, {
                provider: args.provider,
                nonce,
                ipAddress: args.ipAddress ?? undefined,
                userAgent: args.userAgent ?? undefined,
            });
            if (args.status !== "pending") {
                await this._attempts.updateStatus(ctx, systemSec, {
                    id: created.id,
                    status: args.status,
                    userId: args.userId ?? undefined,
                    errorCode: args.errorCode ?? undefined,
                });
            }
        } catch {
            // Audit must never break the auth flow.
        }
    }

    /** @insecure @nochecks */
    async validateToken(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: TokenArgs,
    ): Promise<UserEntity | null> {
        const key = this._sessionCacheKey(args.token);
        const cached = await this._store.get(key);

        if (cached === NEG_CACHE_SENTINEL) {
            // Known-bad token — short-circuit without touching the triple store.
            return null;
        }

        if (cached) {
            const data = JSON.parse(cached) as { userId: string; expiresAt: number };
            if (Date.now() < data.expiresAt) {
                return this._users.findById(ctx, systemSec, { id: data.userId });
            }
            await this._store.del(key);
        }

        const session = await this._sessions.findByToken(ctx, systemSec, { token: args.token });
        if (session?.isActive && session.expiresAt.getTime() > Date.now()) {
            return this._users.findById(ctx, systemSec, { id: session.userId });
        }

        // Negative-cache the miss so repeated garbage tokens stop hitting the
        // triple store. Short TTL bounds the window where a token that becomes
        // valid (it never does — tokens are minted, not guessed) would be denied.
        await this._store.set(key, NEG_CACHE_SENTINEL, AUTH_NEG_CACHE_TTL_SECS);
        return null;
    }

    /** @insecure @nochecks */
    async revokeToken(ctx: ServerContext, _sec: SecurityContext, args: TokenArgs): Promise<void> {
        await Promise.all([
            this._store.del(this._sessionCacheKey(args.token)),
            this._sessions.revoke(ctx, systemSec, { token: args.token }),
        ]);
    }

    /** @insecure @nochecks Returns all sessions (active and inactive) for a user. */
    async listSessions(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: UserIdArgs,
    ): Promise<UserSessionEntity[]> {
        return this._sessions.findByUserId(ctx, systemSec, { userId: args.userId });
    }

    /**
     * @insecure @nochecks
     * Revokes all active sessions for the user: removes them from the fast-path
     * session store AND marks them inactive in the triple store.
     * Returns the count of sessions that were revoked.
     */
    async revokeAllSessions(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: UserIdArgs,
    ): Promise<number> {
        const sessions = await this._sessions.findByUserId(ctx, systemSec, {
            userId: args.userId,
        });
        const active = sessions.filter((s) => s.isActive);

        // s.sessionToken from findByUserId is the stored hash, which is already
        // exactly the cache-key component, so build the URI directly (no re-hash).
        await Promise.all(
            active.map((s) => this._store.del(makeUri(NS_CORE, "session", s.sessionToken))),
        );
        return this._sessions.revokeAllForUser(ctx, systemSec, { userId: args.userId });
    }

    /** Returns true if the provider name is registered. */
    hasProvider(name: string): boolean {
        return this._providers.has(name as OAuthProvider);
    }

    /** Build a SecurityContext for a newly validated session. */
    static buildSecurityContext(opts: {
        user: UserEntity;
        session: UserSessionEntity;
    }): SecurityContext {
        return {
            principalIri: opts.user.iri,
            sessionId: opts.session.id,
            isImpersonating: false,
        };
    }

    /** SecurityContext for unauthenticated callers. */
    static get anonymousSec(): SecurityContext {
        return anonymousSec;
    }
}
