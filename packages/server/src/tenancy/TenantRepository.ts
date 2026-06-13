import type { TripleStore } from "@jasonscharf/data";
import type { EntityRecord } from "@jasonscharf/entities";
import { EntityQuery } from "../EntityQuery.js";
import { EntityStore } from "../EntityStore.js";
import type { SecurityContext } from "../SecurityContext.js";
import type { ServerContext } from "../ServerContext.js";
import { TenantSchema } from "./schemas.js";
import type { TenantEntity } from "./types.js";
import { iriFor, newId } from "./util.js";

export interface CreateTenantArgs {
    name: string;
}

export interface TenantIdArgs {
    id: string;
}

export interface TenantUserArgs {
    tenantId: string;
    userIri: string;
}

export interface UpdateTenantArgs {
    id: string;
    patch: Partial<Pick<TenantEntity, "name">>;
}

/**
 * Data-access layer for Tenant entities — the root of the tenant graph.
 *
 * Tenancy entities are intentionally NOT pinned to a fixed graph: they root the
 * per-tenant named graph, so the EntityStore scopes them by ctx/tenantId. Pinning
 * them would break rooted traversal and tenant isolation (TRN-215).
 *
 * Repositories are the trusted persistence layer and perform NO access checks by
 * design; authorization is enforced one level up (RbacService). The `_sec`
 * argument is threaded for signature symmetry only.
 */
export class TenantRepository {
    private readonly _store: TripleStore;
    private readonly _entities: EntityStore;

    constructor(store: TripleStore) {
        this._store = store;
        this._entities = new EntityStore(store);
    }

    get store(): TripleStore {
        return this._store;
    }

    /** @dataLayer — no checks here; RbacService enforces (see class doc). */
    async create(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: CreateTenantArgs,
    ): Promise<TenantEntity> {
        const record = await this._entities.create(ctx, TenantSchema, { name: args.name }, newId());
        return this._toEntity(record);
    }

    /** @dataLayer — no checks here; RbacService enforces (see class doc). */
    async findById(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: TenantIdArgs,
    ): Promise<TenantEntity | null> {
        const record = await this._entities.findById(ctx, TenantSchema, args.id);
        return record ? this._toEntity(record) : null;
    }

    /** @dataLayer — no checks here; RbacService enforces (see class doc). */
    async addUser(ctx: ServerContext, _sec: SecurityContext, args: TenantUserArgs): Promise<void> {
        await this._entities.collectionPush(
            ctx,
            TenantSchema,
            args.tenantId,
            "users",
            args.userIri,
        );
    }

    /** @dataLayer — no checks here; RbacService enforces (see class doc). */
    async removeUser(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: TenantUserArgs,
    ): Promise<void> {
        await this._entities.collectionRemove(
            ctx,
            TenantSchema,
            args.tenantId,
            "users",
            args.userIri,
        );
    }

    /** @dataLayer — no checks here; RbacService enforces (see class doc). */
    async findUsers(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: TenantIdArgs,
    ): Promise<string[]> {
        const users = await this._entities.collectionGet(ctx, TenantSchema, args.id, "users");
        return users.map(String);
    }

    /** @dataLayer — no checks here; RbacService enforces (see class doc). */
    async findByUser(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: { userIri: string },
    ): Promise<TenantEntity[]> {
        const records = await EntityQuery.from(this._store, TenantSchema)
            .where("users", "=", args.userIri)
            .all(ctx);
        return records.map((r) => this._toEntity(r));
    }

    /** @dataLayer — no checks here; RbacService enforces (see class doc). */
    async update(
        ctx: ServerContext,
        sec: SecurityContext,
        args: UpdateTenantArgs,
    ): Promise<TenantEntity | null> {
        return this._store.withTransaction(ctx, async (ctx) => {
            const existing = await this._entities.findById(ctx, TenantSchema, args.id);
            if (!existing) {
                return null;
            }
            if (args.patch.name !== undefined) {
                await this._entities.update(ctx, TenantSchema, args.id, { name: args.patch.name });
            }
            return this.findById(ctx, sec, { id: args.id });
        });
    }

    /** @dataLayer — no checks here; RbacService enforces (see class doc). */
    async delete(ctx: ServerContext, _sec: SecurityContext, args: TenantIdArgs): Promise<void> {
        await this._entities.delete(ctx, TenantSchema, args.id);
    }

    /** @dataLayer — no checks here; RbacService enforces (see class doc). */
    async listAll(ctx: ServerContext, _sec: SecurityContext): Promise<TenantEntity[]> {
        const records = await EntityQuery.from(this._store, TenantSchema).all(ctx);
        return records.map((r) => this._toEntity(r));
    }

    private _toEntity(record: EntityRecord): TenantEntity {
        const now = new Date();
        return {
            id: record.id,
            iri: iriFor("tenant", record.id).value,
            name: record.props.name != null ? String(record.props.name) : "",
            createdAt: record.createdAt ?? now,
            updatedAt: record.updatedAt ?? now,
        };
    }
}
