import type { TripleStore } from "@jasonscharf/data";
import type { EntityRecord, IFieldCipher } from "@jasonscharf/entities";
import type { SecurityContext, ServerContext } from "@jasonscharf/server";
import { EntityQuery, EntityStore } from "@jasonscharf/server";
import { UserSchema } from "../entities/UserSchema.js";
import type { UserEntity } from "../types.js";
import { newId } from "./util.js";

export interface IdArgs {
    id: string;
}

export interface EmailArgs {
    email: string;
}

export interface UpdateUserArgs {
    id: string;
    patch: Partial<Pick<UserEntity, "displayName" | "avatarUrl" | "email">>;
}

/**
 * Data-access layer for User entities.
 *
 * Repositories are the trusted persistence layer and perform NO access checks
 * by design — exactly like the convos repositories. Authorization is enforced
 * one level up, at the service boundary (AuthService / OAuth callback), which
 * either asserts an RBAC permission or runs a documented system/bootstrap path.
 * The `_sec` argument is threaded through for signature symmetry and so a future
 * row-level policy could hook in, but is intentionally not consulted here.
 */
export class UserRepository {
    private readonly _store: TripleStore;
    private readonly _entities: EntityStore;
    private readonly _cipher?: IFieldCipher;

    constructor(store: TripleStore, cipher?: IFieldCipher) {
        this._store = store;
        // The cipher is bound to the EntityStore (and to every EntityQuery this
        // repo opens) so the PII props displayName / avatarUrl are encrypted on
        // write and decrypted on read even when the caller's ctx carries no
        // cipher.  ctx.cipher still takes precedence when present.
        this._cipher = cipher;
        this._entities = new EntityStore(store, undefined, cipher);
    }

    get store(): TripleStore {
        return this._store;
    }

    /** @dataLayer — no checks here; AuthService enforces (see class doc). */
    async create(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: Pick<UserEntity, "email" | "displayName" | "avatarUrl">,
    ): Promise<UserEntity> {
        const record = await this._entities.create(ctx, UserSchema, args, newId());
        return this._toEntity(record);
    }

    /** @dataLayer — no checks here; AuthService enforces (see class doc). */
    async findById(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: IdArgs,
    ): Promise<UserEntity | null> {
        const record = await this._entities.findById(ctx, UserSchema, args.id);
        return record ? this._toEntity(record) : null;
    }

    /** @dataLayer — no checks here; AuthService enforces (see class doc). */
    async findByEmail(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: EmailArgs,
    ): Promise<UserEntity | null> {
        const record = await EntityQuery.from(this._store, UserSchema, this._cipher)
            .where("email", "=", args.email)
            .first(ctx);
        return record ? this._toEntity(record) : null;
    }

    /** @dataLayer — no checks here; AuthService enforces (see class doc). */
    async update(
        ctx: ServerContext,
        sec: SecurityContext,
        args: UpdateUserArgs,
    ): Promise<UserEntity | null> {
        return this._store.withTransaction(ctx, async (ctx) => {
            const existing = await this._entities.findById(ctx, UserSchema, args.id);
            if (!existing) {
                return null;
            }
            const patch: Record<string, unknown> = {};
            if (args.patch.email !== undefined) {
                patch.email = args.patch.email;
            }
            if (args.patch.displayName !== undefined) {
                patch.displayName = args.patch.displayName;
            }
            if (args.patch.avatarUrl !== undefined) {
                patch.avatarUrl = args.patch.avatarUrl;
            }
            await this._entities.update(ctx, UserSchema, args.id, patch);
            return this.findById(ctx, sec, { id: args.id });
        });
    }

    /** @dataLayer — no checks here; AuthService enforces (see class doc). */
    async delete(ctx: ServerContext, _sec: SecurityContext, args: IdArgs): Promise<void> {
        await this._entities.delete(ctx, UserSchema, args.id);
    }

    private _toEntity(record: EntityRecord): UserEntity {
        const email = record.props.email;
        if (email == null) {
            throw new Error(`UserRepository: missing email for user id "${record.id}"`);
        }
        const now = new Date();
        return {
            id: record.id,
            iri: record.iri,
            email: String(email),
            displayName: record.props.displayName as string | undefined,
            avatarUrl: record.props.avatarUrl as string | undefined,
            createdAt: record.createdAt ?? now,
            updatedAt: record.updatedAt ?? now,
        };
    }
}
