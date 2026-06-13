import type { TripleStore } from "@jasonscharf/data";
import type { EntityRecord } from "@jasonscharf/entities";
import type { SecurityContext, ServerContext } from "@jasonscharf/server";
import { EntityQuery, EntityStore } from "@jasonscharf/server";
import { LoginAttemptSchema } from "../entities/LoginAttemptSchema.js";
import type { LoginAttemptEntity, LoginAttemptStatus, OAuthProvider } from "../types.js";
import { idFrom, iriFor, newId } from "./util.js";

export interface CreateLoginAttemptArgs {
    provider: OAuthProvider;
    nonce: string;
    ipAddress?: string;
    userAgent?: string;
    claim?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    authRedirectUrl?: string;
}

export interface NonceArgs {
    nonce: string;
}

export interface UpdateStatusArgs {
    id: string;
    status: LoginAttemptStatus;
    userId?: string;
    errorCode?: string;
}

/**
 * Data-access layer for LoginAttempt audit entities.
 *
 * Repositories are the trusted persistence layer and perform NO access checks
 * by design — like the convos repositories. Login attempts are recorded by the
 * OAuth callback / AuthService audit path (a documented system/bootstrap path
 * that runs before any principal exists). The `_sec` argument is threaded for
 * signature symmetry but not consulted here.
 */
export class LoginAttemptRepository {
    private readonly _store: TripleStore;
    private readonly _entities: EntityStore;

    constructor(store: TripleStore) {
        this._store = store;
        this._entities = new EntityStore(store);
    }

    get store(): TripleStore {
        return this._store;
    }

    /** @dataLayer — no checks here; AuthService / OAuth callback enforces (see class doc). */
    async create(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: CreateLoginAttemptArgs,
    ): Promise<LoginAttemptEntity> {
        const record = await this._entities.create(
            ctx,
            LoginAttemptSchema,
            {
                provider: args.provider,
                status: "pending",
                nonce: args.nonce,
                ipAddress: args.ipAddress,
                userAgent: args.userAgent,
                claim: args.claim,
                utmSource: args.utmSource,
                utmMedium: args.utmMedium,
                utmCampaign: args.utmCampaign,
                authRedirectUrl: args.authRedirectUrl,
            },
            newId(),
        );
        return this._toEntity(record);
    }

    /** @dataLayer — no checks here; AuthService / OAuth callback enforces (see class doc). */
    async findByNonce(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: NonceArgs,
    ): Promise<LoginAttemptEntity | null> {
        const record = await EntityQuery.from(this._store, LoginAttemptSchema)
            .where("nonce", "=", args.nonce)
            .first(ctx);
        return record ? this._toEntity(record) : null;
    }

    /** @dataLayer — no checks here; AuthService / OAuth callback enforces (see class doc). */
    async updateStatus(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: UpdateStatusArgs,
    ): Promise<void> {
        // Only the supplied fields are patched; update() replaces just those
        // predicates and leaves the rest of the attempt untouched.
        const patch: Record<string, unknown> = { status: args.status };
        if (args.userId) {
            patch.attemptUser = iriFor("user", args.userId).value;
        }
        if (args.errorCode) {
            patch.errorCode = args.errorCode;
        }
        await this._entities.update(ctx, LoginAttemptSchema, args.id, patch);
    }

    private _toEntity(record: EntityRecord): LoginAttemptEntity {
        const nonce = record.props.nonce;
        if (nonce == null) {
            throw new Error(`LoginAttemptRepository: missing nonce for attempt id "${record.id}"`);
        }
        const attemptUser = record.props.attemptUser;
        const now = new Date();
        return {
            id: record.id,
            iri: record.iri,
            provider: (record.props.provider ?? "google") as OAuthProvider,
            status: (record.props.status ?? "pending") as LoginAttemptStatus,
            nonce: String(nonce),
            userId: attemptUser != null ? idFrom(String(attemptUser)) : undefined,
            errorCode: record.props.errorCode as string | undefined,
            ipAddress: record.props.ipAddress as string | undefined,
            userAgent: record.props.userAgent as string | undefined,
            claim: record.props.claim as string | undefined,
            utmSource: record.props.utmSource as string | undefined,
            utmMedium: record.props.utmMedium as string | undefined,
            utmCampaign: record.props.utmCampaign as string | undefined,
            authRedirectUrl: record.props.authRedirectUrl as string | undefined,
            createdAt: record.createdAt ?? now,
            updatedAt: record.updatedAt ?? now,
        };
    }
}
