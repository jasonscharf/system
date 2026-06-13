import type { TripleStore } from "@jasonscharf/data";
import type { EntityRecord } from "@jasonscharf/entities";
import type { SecurityContext, ServerContext } from "@jasonscharf/server";
import { EntityQuery, EntityStore } from "@jasonscharf/server";
import { UserSessionSchema } from "../entities/UserSessionSchema.js";
import type { UserSessionEntity } from "../types.js";
import { hashSessionToken, idFrom, iriFor, newId, newSessionToken } from "./util.js";

export interface CreateSessionArgs {
    userId: string;
    deviceId: string;
    expiresAt: Date;
    ipAddress?: string;
}

export interface TokenArgs {
    token: string;
}

export interface UserIdArgs {
    userId: string;
}

/**
 * Data-access layer for UserSession entities.
 *
 * Repositories are the trusted persistence layer and perform NO access checks
 * by design — like the convos repositories. Session authorization is enforced
 * one level up: AuthService gates cross-user session administration via RBAC,
 * and self-service session ops authenticate by possession of the raw token.
 * The `_sec` argument is threaded for signature symmetry but not consulted here.
 */
export class UserSessionRepository {
    private readonly _store: TripleStore;
    private readonly _entities: EntityStore;

    constructor(store: TripleStore) {
        this._store = store;
        this._entities = new EntityStore(store);
    }

    get store(): TripleStore {
        return this._store;
    }

    /** @dataLayer — no checks here; AuthService enforces (see class doc). */
    async create(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: CreateSessionArgs,
    ): Promise<UserSessionEntity> {
        // The raw token is handed back to the caller (cookie / fast-path cache)
        // exactly once, here.  Only its one-way hash is ever persisted, so the
        // raw token never lands in the nodes table.
        const token = newSessionToken();
        const record = await this._entities.create(
            ctx,
            UserSessionSchema,
            {
                sessionToken: hashSessionToken(token),
                sessionUser: iriFor("user", args.userId).value,
                sessionDevice: iriFor("device", args.deviceId).value,
                expiresAt: args.expiresAt,
                isActive: true,
                ipAddress: args.ipAddress,
            },
            newId(),
        );
        // Overlay the raw token onto the returned entity so the caller can issue
        // it.  Every other read path (findByToken/findByUserId) returns the hash.
        return { ...this._toEntity(record), sessionToken: token };
    }

    /** @dataLayer — no checks here; AuthService enforces (see class doc). */
    async findByToken(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: TokenArgs,
    ): Promise<UserSessionEntity | null> {
        // Look up by the hash of the incoming raw token — a single indexed
        // equality match, never a full session scan.
        const record = await EntityQuery.from(this._store, UserSessionSchema)
            .where("sessionToken", "=", hashSessionToken(args.token))
            .first(ctx);
        return record ? this._toEntity(record) : null;
    }

    /** @dataLayer — no checks here; AuthService enforces (see class doc). */
    async findByUserId(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: UserIdArgs,
    ): Promise<UserSessionEntity[]> {
        const records = await EntityQuery.from(this._store, UserSessionSchema)
            .where("sessionUser", "=", iriFor("user", args.userId).value)
            .all(ctx);
        return records.map((r) => this._toEntity(r));
    }

    /** @dataLayer — no checks here; AuthService enforces (see class doc). */
    async revoke(ctx: ServerContext, sec: SecurityContext, args: TokenArgs): Promise<boolean> {
        return this._store.withTransaction(ctx, async (ctx) => {
            const session = await this.findByToken(ctx, sec, args);
            if (!session) {
                return false;
            }
            await this._entities.update(ctx, UserSessionSchema, session.id, { isActive: false });
            return true;
        });
    }

    /** @dataLayer — no checks here; AuthService enforces (see class doc). */
    async revokeAllForUser(
        ctx: ServerContext,
        sec: SecurityContext,
        args: UserIdArgs,
    ): Promise<number> {
        return this._store.withTransaction(ctx, async (ctx) => {
            // One batched query for all the user's sessions — no per-session find.
            const sessions = await this.findByUserId(ctx, sec, args);
            const active = sessions.filter((s) => s.isActive);
            for (const s of active) {
                await this._entities.update(ctx, UserSessionSchema, s.id, { isActive: false });
            }
            return active.length;
        });
    }

    /** @dataLayer — no checks here; AuthService enforces (see class doc). */
    async deleteExpired(ctx: ServerContext, _sec: SecurityContext): Promise<number> {
        return this._store.withTransaction(ctx, async (ctx) => {
            // One batched query for every session — no per-session find inside the loop.
            const sessions = await EntityQuery.from(this._store, UserSessionSchema).all(ctx);
            const now = Date.now();
            const expired = sessions
                .map((s) => this._toEntity(s))
                .filter((s) => s.expiresAt.getTime() < now);
            for (const s of expired) {
                await this._entities.delete(ctx, UserSessionSchema, s.id);
            }
            return expired.length;
        });
    }

    private _toEntity(record: EntityRecord): UserSessionEntity {
        const sessionToken = record.props.sessionToken;
        if (sessionToken == null) {
            throw new Error(
                `UserSessionRepository: missing sessionToken for session id "${record.id}"`,
            );
        }
        const sessionUser = record.props.sessionUser;
        if (sessionUser == null) {
            throw new Error(
                `UserSessionRepository: missing sessionUser for session id "${record.id}"`,
            );
        }
        const sessionDevice = record.props.sessionDevice;
        if (sessionDevice == null) {
            throw new Error(
                `UserSessionRepository: missing sessionDevice for session id "${record.id}"`,
            );
        }
        const expiresAt = record.props.expiresAt;
        if (expiresAt == null) {
            throw new Error(
                `UserSessionRepository: missing expiresAt for session id "${record.id}"`,
            );
        }
        return {
            id: record.id,
            iri: record.iri,
            sessionToken: String(sessionToken),
            userId: idFrom(String(sessionUser)),
            deviceId: idFrom(String(sessionDevice)),
            expiresAt: expiresAt instanceof Date ? expiresAt : new Date(String(expiresAt)),
            isActive: record.props.isActive === true,
            ipAddress: record.props.ipAddress as string | undefined,
            createdAt: record.createdAt ?? new Date(),
        };
    }
}
