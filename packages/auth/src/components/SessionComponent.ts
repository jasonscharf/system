import { noCtx } from '@system/data';
import { FlowComponent, type FlowComponentOptions } from '@system/flow';
import { FlowPort } from '@system/flow';
import type { ISessionStore } from '../session/ISessionStore.js';
import type { UserRepository } from '../repository/UserRepository.js';
import type { UserSessionRepository } from '../repository/UserSessionRepository.js';
import type { SessionData, UserEntity, UserSessionEntity } from '../types.js';


export interface ValidateRequest {
    token:      string;
    requestId?: string;
}

export interface ValidateResult {
    valid:      boolean;
    user?:      UserEntity;
    session?:   UserSessionEntity;
    requestId?: string;
}

export interface RevokeRequest {
    token:      string;
    requestId?: string;
}

export interface RevokeResult {
    success:    boolean;
    requestId?: string;
}

export interface SessionComponentOptions extends FlowComponentOptions {
    sessionStore: ISessionStore;
    users:        UserRepository;
    sessions:     UserSessionRepository;
}

/**
 * Async FBP component for session validation and revocation.
 *
 * Validation uses a two-tier lookup: fast Redis/memory store first,
 * then falls back to the TripleStore for resilience across restarts.
 */
export class SessionComponent extends FlowComponent {
    readonly validateIn:  FlowPort<ValidateRequest>;
    readonly validateOut: FlowPort<ValidateResult>;
    readonly revokeIn:    FlowPort<RevokeRequest>;
    readonly revokeOut:   FlowPort<RevokeResult>;

    private readonly _store:    ISessionStore;
    private readonly _users:    UserRepository;
    private readonly _sessions: UserSessionRepository;

    constructor(options: SessionComponentOptions) {
        super(options);
        this.validateIn  = this.addPort<ValidateRequest>('validateIn',  'in');
        this.validateOut = this.addPort<ValidateResult>('validateOut', 'out');
        this.revokeIn    = this.addPort<RevokeRequest>('revokeIn',    'in');
        this.revokeOut   = this.addPort<RevokeResult>('revokeOut',   'out');

        this._store    = options.sessionStore;
        this._users    = options.users;
        this._sessions = options.sessions;
    }

    override step(): void {
        let vReq: ValidateRequest | undefined;
        while ((vReq = this.validateIn.read()) !== undefined) {
            void this._validate(vReq);
        }
        let rReq: RevokeRequest | undefined;
        while ((rReq = this.revokeIn.read()) !== undefined) {
            void this._revoke(rReq);
        }
    }

    private async _validate(req: ValidateRequest): Promise<void> {
        const key = `tern:session:${req.token}`;

        // Fast path: Redis / memory store
        const cached = await this._store.get(key);
        if (cached) {
            const data    = JSON.parse(cached) as SessionData;
            const expired = Date.now() > data.expiresAt;
            if (!expired) {
                const user = await this._users.findById(noCtx, data.userId);
                if (user) {
                    const session = await this._sessions.findByToken(noCtx, req.token);
                    this.validateOut.put({ valid: true, user, session: session ?? undefined, requestId: req.requestId });
                    return;
                }
            }
            await this._store.del(key);
        }

        // Slow path: TripleStore
        const session = await this._sessions.findByToken(noCtx, req.token);
        if (session && session.isActive && session.expiresAt.getTime() > Date.now()) {
            const user = await this._users.findById(noCtx, session.userId);
            if (user) {
                this.validateOut.put({ valid: true, user, session, requestId: req.requestId });
                return;
            }
        }

        this.validateOut.put({ valid: false, requestId: req.requestId });
    }

    private async _revoke(req: RevokeRequest): Promise<void> {
        const [storeOk, dbOk] = await Promise.all([
            this._store.del(`tern:session:${req.token}`).then(() => true).catch(() => false),
            this._sessions.revoke(noCtx, req.token),
        ]);
        this.revokeOut.put({ success: storeOk && dbOk, requestId: req.requestId });
    }
}
