import { makeUri, NS_CORE } from "@jasonscharf/core";
import { FlowComponent, type FlowComponentOptions, type FlowPort } from "@jasonscharf/flow";
import { buildServerContext, systemSec } from "@jasonscharf/server";
import { SESSION_TTL_SECS } from "../constants.js";
import type { IOAuthProvider } from "../oauth/types.js";
import type { UserDeviceRepository } from "../repository/UserDeviceRepository.js";
import type { UserIdentityRepository } from "../repository/UserIdentityRepository.js";
import type { UserRepository } from "../repository/UserRepository.js";
import type { UserSessionRepository } from "../repository/UserSessionRepository.js";
import { hashSessionToken } from "../repository/util.js";
import type { ISessionStore } from "../session/ISessionStore.js";
import type { DeviceInfo, OAuthProvider, UserEntity, UserSessionEntity } from "../types.js";

export interface CallbackRequest {
    provider: OAuthProvider;
    code: string;
    state: string;
    redirectUri: string;
    device: DeviceInfo;
    ipAddress?: string;
    requestId?: string;
}

export interface CallbackSuccess {
    user: UserEntity;
    session: UserSessionEntity;
    requestId?: string;
}

export interface CallbackError {
    error: string;
    requestId?: string;
}

export interface CallbackComponentOptions extends FlowComponentOptions {
    providers: IOAuthProvider[];
    sessionStore: ISessionStore;
    users: UserRepository;
    identities: UserIdentityRepository;
    sessions: UserSessionRepository;
    devices: UserDeviceRepository;
}

/**
 * Async FBP component that handles the OAuth callback cycle:
 *   code exchange → profile fetch → upsert User/Identity/Device → create Session
 *
 * On success puts to successOut; on any failure puts to errorOut.
 */
export class CallbackComponent extends FlowComponent {
    readonly callbackIn: FlowPort<CallbackRequest>;
    readonly successOut: FlowPort<CallbackSuccess>;
    readonly errorOut: FlowPort<CallbackError>;

    private readonly _providers: Map<OAuthProvider, IOAuthProvider>;
    private readonly _sessions: ISessionStore;
    private readonly _users: UserRepository;
    private readonly _identities: UserIdentityRepository;
    private readonly _sessRepo: UserSessionRepository;
    private readonly _devices: UserDeviceRepository;

    constructor(options: CallbackComponentOptions) {
        super(options);
        this.callbackIn = this.addPort<CallbackRequest>("callbackIn", "in");
        this.successOut = this.addPort<CallbackSuccess>("successOut", "out");
        this.errorOut = this.addPort<CallbackError>("errorOut", "out");

        this._providers = new Map(options.providers.map((p) => [p.name, p]));
        this._sessions = options.sessionStore;
        this._users = options.users;
        this._identities = options.identities;
        this._sessRepo = options.sessions;
        this._devices = options.devices;
    }

    override step(): void {
        for (;;) {
            const req = this.callbackIn.read();
            if (req === undefined) {
                break;
            }
            void this._process(req);
        }
    }

    private async _process(req: CallbackRequest): Promise<void> {
        try {
            const provider = this._providers.get(req.provider);
            if (!provider) {
                throw new Error(`Unknown provider: ${req.provider}`);
            }

            // Exchange code → tokens + profile
            const { profile, tokens } = await provider.exchangeCode(req.code, req.redirectUri);

            const ctx = buildServerContext(this._users.store);
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
            let identity = await this._identities.findByProvider(ctx, sec, {
                provider: req.provider,
                providerUserId: profile.providerUserId,
            });
            if (!identity) {
                identity = await this._identities.create(ctx, sec, {
                    provider: req.provider,
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

            // Upsert device
            const device = await this._devices.findOrCreate(ctx, sec, {
                userId: user.id,
                info: req.device,
            });

            // Create session (store in both TripleStore and Redis/memory)
            const expiresAt = new Date(Date.now() + SESSION_TTL_SECS * 1000);
            const session = await this._sessRepo.create(ctx, sec, {
                userId: user.id,
                deviceId: device.id,
                expiresAt,
                ipAddress: req.ipAddress,
            });

            await this._sessions.set(
                // session.sessionToken is the raw token from create(); hash it so
                // the cache key matches validateToken and no raw token is cached.
                makeUri(NS_CORE, "session", hashSessionToken(session.sessionToken)),
                JSON.stringify({
                    userId: user.id,
                    deviceId: device.id,
                    expiresAt: expiresAt.getTime(),
                }),
                SESSION_TTL_SECS,
            );

            this.successOut.put({ user, session, requestId: req.requestId });
        } catch (err) {
            this.errorOut.put({ error: String(err), requestId: req.requestId });
        }
    }
}
