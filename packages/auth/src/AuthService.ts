import { randomBytes } from 'node:crypto';
import type { IOAuthProvider } from './oauth/types.js';
import type { ISessionStore } from './session/ISessionStore.js';
import type { UserRepository } from './repository/UserRepository.js';
import type { UserIdentityRepository } from './repository/UserIdentityRepository.js';
import type { UserSessionRepository } from './repository/UserSessionRepository.js';
import type { UserDeviceRepository } from './repository/UserDeviceRepository.js';
import { defaultServerContext } from '@jasonscharf/server';
import { SESSION_TTL_SECS } from './constants.js';
import type {
    DeviceInfo, OAuthProvider,
    UserEntity, UserSessionEntity,
} from './types.js';


export interface LoginResult {
    user:    UserEntity;
    session: UserSessionEntity;
}

/**
 * Core auth business logic — provider-agnostic, transport-agnostic.
 * Used directly by HTTP/WS handlers and wrapped by FBP components.
 */
export class AuthService {
    private readonly _providers:  Map<OAuthProvider, IOAuthProvider>;
    private readonly _store:      ISessionStore;
    private readonly _users:      UserRepository;
    private readonly _identities: UserIdentityRepository;
    private readonly _sessions:   UserSessionRepository;
    private readonly _devices:    UserDeviceRepository;

    constructor(opts: {
        providers:    IOAuthProvider[];
        sessionStore: ISessionStore;
        users:        UserRepository;
        identities:   UserIdentityRepository;
        sessions:     UserSessionRepository;
        devices:      UserDeviceRepository;
    }) {
        this._providers  = new Map(opts.providers.map(p => [p.name, p]));
        this._store      = opts.sessionStore;
        this._users      = opts.users;
        this._identities = opts.identities;
        this._sessions   = opts.sessions;
        this._devices    = opts.devices;
    }

    getProvider(name: OAuthProvider): IOAuthProvider {
        const p = this._providers.get(name);
        if (!p) { throw new Error(`Unknown OAuth provider: ${name}`); }
        return p;
    }

    buildAuthUrl(provider: OAuthProvider, redirectUri: string): { url: string; state: string } {
        const state = randomBytes(16).toString('hex');
        return { url: this.getProvider(provider).getAuthUrl(redirectUri, state), state };
    }

    async handleCallback(opts: {
        provider:    OAuthProvider;
        code:        string;
        redirectUri: string;
        device:      DeviceInfo;
        ipAddress?:  string;
    }): Promise<LoginResult> {
        const { profile, tokens } = await this.getProvider(opts.provider).exchangeCode(opts.code, opts.redirectUri);

        // All DB writes are atomic within a single transaction.
        const { user, session } = await this._users.store.withTransaction(defaultServerContext, async ctx => {
            // Upsert user
            let user = await this._users.findByEmail(ctx, profile.email);
            if (!user) {
                user = await this._users.create(ctx, {
                    email:       profile.email,
                    displayName: profile.displayName,
                    avatarUrl:   profile.avatarUrl,
                });
            } else if (profile.displayName || profile.avatarUrl) {
                user = (await this._users.update(ctx, user.id, {
                    displayName: profile.displayName ?? user.displayName,
                    avatarUrl:   profile.avatarUrl   ?? user.avatarUrl,
                })) ?? user;
            }

            // Upsert identity
            const identity = await this._identities.findByProvider(ctx, opts.provider, profile.providerUserId);
            if (!identity) {
                await this._identities.create(ctx, {
                    provider:       opts.provider,
                    providerUserId: profile.providerUserId,
                    providerEmail:  profile.email,
                    accessToken:    tokens.accessToken,
                    refreshToken:   tokens.refreshToken,
                    tokenExpiresAt: tokens.expiresAt,
                    userId:         user.id,
                });
            } else {
                await this._identities.updateTokens(ctx, identity.id, {
                    accessToken:    tokens.accessToken,
                    refreshToken:   tokens.refreshToken,
                    tokenExpiresAt: tokens.expiresAt,
                });
            }

            // Upsert device and create session
            const device    = await this._devices.findOrCreate(ctx, user.id, opts.device);
            const expiresAt = new Date(Date.now() + SESSION_TTL_SECS * 1000);
            const session   = await this._sessions.create(ctx, {
                userId:    user.id,
                deviceId:  device.id,
                expiresAt,
                ipAddress: opts.ipAddress,
            });

            return { user, session, expiresAt, deviceId: device.id };
        });

        await this._store.set(
            `tern:session:${session.sessionToken}`,
            JSON.stringify({ userId: user.id, deviceId: session.deviceId, expiresAt: session.expiresAt.getTime() }),
            SESSION_TTL_SECS,
        );

        return { user, session };
    }

    async validateToken(token: string): Promise<UserEntity | null> {
        const key    = `tern:session:${token}`;
        const cached = await this._store.get(key);

        if (cached) {
            const data = JSON.parse(cached) as { userId: string; expiresAt: number };
            if (Date.now() < data.expiresAt) {
                return this._users.findById(defaultServerContext, data.userId);
            }
            await this._store.del(key);
        }

        const session = await this._sessions.findByToken(defaultServerContext, token);
        if (session && session.isActive && session.expiresAt.getTime() > Date.now()) {
            return this._users.findById(defaultServerContext, session.userId);
        }
        return null;
    }

    async revokeToken(token: string): Promise<void> {
        await Promise.all([
            this._store.del(`tern:session:${token}`),
            this._sessions.revoke(defaultServerContext, token),
        ]);
    }

    /** Returns all sessions (active and inactive) for a user. */
    async listSessions(userId: string): Promise<import('./types.js').UserSessionEntity[]> {
        return this._sessions.findByUserId(defaultServerContext, userId);
    }

    /**
     * Revokes all active sessions for the user: removes them from the fast-path
     * session store AND marks them inactive in the triple store.
     * Returns the count of sessions that were revoked.
     */
    async revokeAllSessions(userId: string): Promise<number> {
        const sessions = await this._sessions.findByUserId(defaultServerContext, userId);
        const active   = sessions.filter(s => s.isActive);

        await Promise.all(
            active.map(s => this._store.del(`tern:session:${s.sessionToken}`)),
        );
        return this._sessions.revokeAllForUser(defaultServerContext, userId);
    }

    /** Returns true if the provider name is registered. */
    hasProvider(name: string): boolean {
        return this._providers.has(name as import('./types.js').OAuthProvider);
    }
}
