import { getLog, Inject } from "@jasonscharf/core";
import { FlowComponent, type FlowComponentOptions, type FlowPort } from "@jasonscharf/flow";
import { buildServerContext, systemSec } from "@jasonscharf/server";
// biome-ignore lint/style/useImportType: runtime DI token for @Inject (emitDecoratorMetadata); import type would elide it
import { UserRepository } from "../repository/UserRepository.js";
// biome-ignore lint/style/useImportType: runtime DI token for @Inject (emitDecoratorMetadata); import type would elide it
import { UserSessionRepository } from "../repository/UserSessionRepository.js";
import { sessionCacheKey } from "../repository/util.js";
// biome-ignore lint/style/useImportType: runtime DI token for @Inject (emitDecoratorMetadata); import type would elide it
import { SessionStore } from "../services.js";
import type { SessionData, UserEntity, UserSessionEntity } from "../types.js";

const log = getLog("tern:auth:session");

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
 * The fast Redis/memory store front-runs the TripleStore, but only ever to
 * reject: the TripleStore holds `isActive` and is the sole authority on whether
 * a session still validates. Both tiers key off `sessionCacheKey`, so an entry
 * one path writes is the entry another path reads and evicts.
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
            this._validate(vReq).catch((err: unknown) => {
                log.error("session.validate-failed", "Session validation failed", {
                    error: String(err),
                });
            });
        }
        for (;;) {
            const rReq = this.revokeIn.read();
            if (rReq === undefined) {
                break;
            }
            this._revoke(rReq).catch((err: unknown) => {
                log.error("session.revoke-failed", "Session revocation failed", {
                    error: String(err),
                });
            });
        }
    }

    private async _validate(req: ValidateRequest): Promise<void> {
        const key = sessionCacheKey(req.token);
        try {
            const ctx = buildServerContext(this._users.store);
            const sec = systemSec;

            // The cached blob is written once when the session is minted and
            // never rewritten, so it can only ever say "live". It is read to
            // evict an entry the clock has already passed, never to authorize.
            const cached = await this._store.get(key);
            if (cached) {
                const data = JSON.parse(cached) as SessionData;
                if (Date.now() > data.expiresAt) {
                    await this._store.del(key);
                }
            }

            // `isActive` lives in the TripleStore, so the TripleStore decides.
            // A revocation recorded by any path takes effect on the very next
            // validate instead of at the end of the session TTL.
            const session = await this._sessions.findByToken(ctx, sec, { token: req.token });
            if (session?.isActive && session.expiresAt.getTime() > Date.now()) {
                const user = await this._users.findById(ctx, sec, { id: session.userId });
                if (user) {
                    this.validateOut.put({ valid: true, user, session, requestId: req.requestId });
                    return;
                }
            }

            // Not valid: drop any fast-path entry so the cache does not outlive
            // the record it describes.
            await this._store.del(key);
            this.validateOut.put({ valid: false, requestId: req.requestId });
        } catch (err) {
            // Fail closed, and always answer. A validation that threw without
            // putting to the port would strand the caller on a silent port.
            log.error("session.validate-failed", "Session validation failed", {
                error: String(err),
            });
            this.validateOut.put({ valid: false, requestId: req.requestId });
        }
    }

    private async _revoke(req: RevokeRequest): Promise<void> {
        const ctx = buildServerContext(this._users.store);
        const sec = systemSec;

        // Ordered, not parallel. The TripleStore is the authority, so it is
        // revoked first and the cache entry is dropped only once the record is
        // actually inactive. A store revoke that throws leaves the cache alone,
        // so there is no window in which the entry is gone while the record is
        // still live.
        let dbOk: boolean;
        try {
            dbOk = await this._sessions.revoke(ctx, sec, { token: req.token });
        } catch (err) {
            log.error("session.revoke-failed", "Failed to revoke a session in the store", {
                error: String(err),
            });
            this.revokeOut.put({ success: false, requestId: req.requestId });
            return;
        }

        let cacheOk = true;
        try {
            await this._store.del(sessionCacheKey(req.token));
        } catch (err) {
            cacheOk = false;
            log.error(
                "session.cache.evict-failed",
                "Failed to evict a revoked session from the fast-path cache",
                { error: String(err) },
            );
        }

        this.revokeOut.put({ success: dbOk && cacheOk, requestId: req.requestId });
    }
}
