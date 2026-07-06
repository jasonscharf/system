import { Inject, makeUri, NS_CORE } from "@jasonscharf/core";
import { FlowComponent, type FlowComponentOptions, type FlowPort } from "@jasonscharf/flow";
import { buildServerContext, systemSec } from "@jasonscharf/server";
import type { UserRepository } from "../repository/UserRepository.js";
import type { UserSessionRepository } from "../repository/UserSessionRepository.js";
import type { SessionStore } from "../services.js";
import type { SessionData, UserEntity, UserSessionEntity } from "../types.js";

export interface ValidateRequest {
    token: string;
    requestId?: string;
}

export interface ValidateResult {
    valid: boolean;
    user?: UserEntity;
    session?: UserSessionEntity;
    requestId?: string;
}

export interface RevokeRequest {
    token: string;
    requestId?: string;
}

export interface RevokeResult {
    success: boolean;
    requestId?: string;
}

export type SessionComponentOptions = FlowComponentOptions;

/**
 * Async FBP component for session validation and revocation.
 *
 * Validation uses a two-tier lookup: fast Redis/memory store first,
 * then falls back to the TripleStore for resilience across restarts.
 */
export class SessionComponent extends FlowComponent {
    readonly validateIn: FlowPort<ValidateRequest>;
    readonly validateOut: FlowPort<ValidateResult>;
    readonly revokeIn: FlowPort<RevokeRequest>;
    readonly revokeOut: FlowPort<RevokeResult>;

    @Inject private readonly _store: SessionStore;
    @Inject private readonly _users: UserRepository;
    @Inject private readonly _sessions: UserSessionRepository;

    constructor(options: SessionComponentOptions) {
        super(options);
        this.validateIn = this.addPort<ValidateRequest>("validateIn", "in");
        this.validateOut = this.addPort<ValidateResult>("validateOut", "out");
        this.revokeIn = this.addPort<RevokeRequest>("revokeIn", "in");
        this.revokeOut = this.addPort<RevokeResult>("revokeOut", "out");
    }

    override step(): void {
        for (;;) {
            const vReq = this.validateIn.read();
            if (vReq === undefined) {
                break;
            }
            void this._validate(vReq);
        }
        for (;;) {
            const rReq = this.revokeIn.read();
            if (rReq === undefined) {
                break;
            }
            void this._revoke(rReq);
        }
    }

    private async _validate(req: ValidateRequest): Promise<void> {
        const ctx = buildServerContext(this._users.store);
        const sec = systemSec;
        const key = makeUri(NS_CORE, "session", req.token);

        // Fast path: Redis / memory store
        const cached = await this._store.get(key);
        if (cached) {
            const data = JSON.parse(cached) as SessionData;
            const expired = Date.now() > data.expiresAt;
            if (!expired) {
                const user = await this._users.findById(ctx, sec, { id: data.userId });
                if (user) {
                    const session = await this._sessions.findByToken(ctx, sec, {
                        token: req.token,
                    });
                    this.validateOut.put({
                        valid: true,
                        user,
                        session: session ?? undefined,
                        requestId: req.requestId,
                    });
                    return;
                }
            }
            await this._store.del(key);
        }

        // Slow path: TripleStore
        const session = await this._sessions.findByToken(ctx, sec, { token: req.token });
        if (session?.isActive && session.expiresAt.getTime() > Date.now()) {
            const user = await this._users.findById(ctx, sec, { id: session.userId });
            if (user) {
                this.validateOut.put({ valid: true, user, session, requestId: req.requestId });
                return;
            }
        }

        this.validateOut.put({ valid: false, requestId: req.requestId });
    }

    private async _revoke(req: RevokeRequest): Promise<void> {
        const ctx = buildServerContext(this._users.store);
        const sec = systemSec;
        const [storeOk, dbOk] = await Promise.all([
            this._store
                .del(makeUri(NS_CORE, "session", req.token))
                .then(() => true)
                .catch(() => false),
            this._sessions.revoke(ctx, sec, { token: req.token }),
        ]);
        this.revokeOut.put({ success: storeOk && dbOk, requestId: req.requestId });
    }
}
