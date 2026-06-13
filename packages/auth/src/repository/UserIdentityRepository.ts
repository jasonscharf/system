import type { TripleStore } from "@jasonscharf/data";
import type { EntityRecord, IFieldCipher } from "@jasonscharf/entities";
import type { SecurityContext, ServerContext } from "@jasonscharf/server";
import { EntityQuery, EntityStore } from "@jasonscharf/server";
import { UserIdentitySchema } from "../entities/UserIdentitySchema.js";
import type { OAuthProvider, UserIdentityEntity } from "../types.js";
import { idFrom, iriFor, newId } from "./util.js";

export interface FindByProviderArgs {
    provider: OAuthProvider;
    providerUserId: string;
}

export interface UserIdArgs {
    userId: string;
}

export interface UpdateTokensArgs {
    id: string;
    tokens: Pick<UserIdentityEntity, "accessToken" | "refreshToken" | "tokenExpiresAt">;
}

export class UserIdentityRepository {
    private readonly _store: TripleStore;
    private readonly _entities: EntityStore;
    private readonly _cipher?: IFieldCipher;

    constructor(store: TripleStore, cipher?: IFieldCipher) {
        this._store = store;
        // The cipher is bound to the EntityStore (and to every EntityQuery this
        // repo opens) so accessToken / refreshToken are encrypted on write and
        // decrypted on read even when the caller's ctx carries no cipher.
        // ctx.cipher still takes precedence when present.
        this._cipher = cipher;
        this._entities = new EntityStore(store, undefined, cipher);
    }

    get store(): TripleStore {
        return this._store;
    }

    /** @insecure @nochecks */
    async create(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: Omit<UserIdentityEntity, "id" | "iri" | "createdAt" | "updatedAt">,
    ): Promise<UserIdentityEntity> {
        const record = await this._entities.create(
            ctx,
            UserIdentitySchema,
            {
                provider: args.provider,
                providerUserId: args.providerUserId,
                providerEmail: args.providerEmail,
                accessToken: args.accessToken,
                refreshToken: args.refreshToken,
                tokenExpiresAt: args.tokenExpiresAt,
                identityOf: iriFor("user", args.userId).value,
            },
            newId(),
        );
        return this._toEntity(record);
    }

    /** @insecure @nochecks */
    async findByProvider(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: FindByProviderArgs,
    ): Promise<UserIdentityEntity | null> {
        const record = await EntityQuery.from(this._store, UserIdentitySchema, this._cipher)
            .where("provider", "=", args.provider)
            .where("providerUserId", "=", args.providerUserId)
            .first(ctx);
        return record ? this._toEntity(record) : null;
    }

    /** @insecure @nochecks */
    async findByUserId(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: UserIdArgs,
    ): Promise<UserIdentityEntity[]> {
        const records = await EntityQuery.from(this._store, UserIdentitySchema, this._cipher)
            .where("identityOf", "=", iriFor("user", args.userId).value)
            .all(ctx);
        return records.map((r) => this._toEntity(r));
    }

    /** @insecure @nochecks */
    async updateTokens(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: UpdateTokensArgs,
    ): Promise<void> {
        // A patch of all three token props: update() clears each predicate then
        // re-inserts only the defined values, so an absent refreshToken /
        // tokenExpiresAt is removed — matching the prior delete-then-insert flow.
        await this._entities.update(ctx, UserIdentitySchema, args.id, {
            accessToken: args.tokens.accessToken,
            refreshToken: args.tokens.refreshToken,
            tokenExpiresAt: args.tokens.tokenExpiresAt,
        });
    }

    private _toEntity(record: EntityRecord): UserIdentityEntity {
        const identityOf = record.props.identityOf;
        if (identityOf == null) {
            throw new Error(
                `UserIdentityRepository: missing identityOf for identity id "${record.id}"`,
            );
        }
        const provider = record.props.provider;
        if (provider == null) {
            throw new Error(
                `UserIdentityRepository: missing provider for identity id "${record.id}"`,
            );
        }
        const providerUserId = record.props.providerUserId;
        if (providerUserId == null) {
            throw new Error(
                `UserIdentityRepository: missing providerUserId for identity id "${record.id}"`,
            );
        }
        const providerEmail = record.props.providerEmail;
        if (providerEmail == null) {
            throw new Error(
                `UserIdentityRepository: missing providerEmail for identity id "${record.id}"`,
            );
        }
        const accessToken = record.props.accessToken;
        if (accessToken == null) {
            throw new Error(
                `UserIdentityRepository: missing accessToken for identity id "${record.id}"`,
            );
        }
        const tokenExpiresAt = record.props.tokenExpiresAt;
        const now = new Date();
        return {
            id: record.id,
            iri: record.iri,
            provider: String(provider) as OAuthProvider,
            providerUserId: String(providerUserId),
            providerEmail: String(providerEmail),
            accessToken: String(accessToken),
            refreshToken: record.props.refreshToken as string | undefined,
            tokenExpiresAt:
                tokenExpiresAt == null
                    ? undefined
                    : tokenExpiresAt instanceof Date
                      ? tokenExpiresAt
                      : new Date(String(tokenExpiresAt)),
            userId: idFrom(String(identityOf)),
            createdAt: record.createdAt ?? now,
            updatedAt: record.updatedAt ?? now,
        };
    }
}
