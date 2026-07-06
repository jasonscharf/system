import type { TripleStore } from "@jasonscharf/data";
import type { EntityRecord } from "@jasonscharf/entities";
import { EntityQuery } from "../EntityQuery.js";
import type { EntityStore } from "../EntityStore.js";
import { createEntityStore } from "../EntityStoreFactory.js";
import type { SecurityContext } from "../SecurityContext.js";
import type { ServerContext } from "../ServerContext.js";
import { OrgSchema } from "./schemas.js";
import type { OrganizationEntity } from "./types.js";
import { iriFor, newId } from "./util.js";

export interface CreateOrgArgs {
    name: string;
    tenantIri: string;
    ownerIri: string;
}

export interface OrgIdArgs {
    id: string;
}

export interface OrgUserArgs {
    orgId: string;
    userIri: string;
}

export interface OrgIriArgs {
    userIri: string;
}

export interface OrgTenantArgs {
    tenantIri: string;
}

export interface RenameOrgArgs {
    id: string;
    name: string;
}

/**
 * Data-access layer for Organization entities.
 *
 * Like the Tenant repo, org entities are NOT pinned to a fixed graph — they live
 * in the per-tenant graph the EntityStore derives from ctx, preserving tenant
 * isolation. The `tenant` / `owner` foreign-key scalars are modelled as
 * (non-containment) object-property edges so they stay traversable by IRI.
 *
 * Repositories perform NO access checks; authorization is enforced one level up
 * (RbacService). `_sec` is threaded for signature symmetry only.
 */
export class OrganizationRepository {
    private readonly _store: TripleStore;
    private readonly _entities: EntityStore;

    constructor(store: TripleStore) {
        this._store = store;
        this._entities = createEntityStore(store);
    }

    get store(): TripleStore {
        return this._store;
    }

    /** @dataLayer — no checks here; RbacService enforces (see class doc). */
    async create(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: CreateOrgArgs,
    ): Promise<OrganizationEntity> {
        const record = await this._entities.create(
            ctx,
            OrgSchema,
            { name: args.name, tenant: args.tenantIri, owner: args.ownerIri },
            newId(),
        );
        return this._toEntity(record);
    }

    /** @dataLayer — no checks here; RbacService enforces (see class doc). */
    async findById(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: OrgIdArgs,
    ): Promise<OrganizationEntity | null> {
        const record = await this._entities.findById(ctx, OrgSchema, args.id);
        return record ? this._toEntity(record) : null;
    }

    /** @dataLayer — no checks here; RbacService enforces (see class doc). */
    async addUser(ctx: ServerContext, _sec: SecurityContext, args: OrgUserArgs): Promise<void> {
        await this._entities.collectionPush(ctx, OrgSchema, args.orgId, "users", args.userIri);
    }

    /** @dataLayer — no checks here; RbacService enforces (see class doc). */
    async removeUser(ctx: ServerContext, _sec: SecurityContext, args: OrgUserArgs): Promise<void> {
        await this._entities.collectionRemove(ctx, OrgSchema, args.orgId, "users", args.userIri);
    }

    /** @dataLayer — no checks here; RbacService enforces (see class doc). */
    async findUsers(ctx: ServerContext, _sec: SecurityContext, args: OrgIdArgs): Promise<string[]> {
        const users = await this._entities.collectionGet(ctx, OrgSchema, args.id, "users");
        return users.map(String);
    }

    /** @dataLayer — no checks here; RbacService enforces (see class doc). */
    async findByUserIri(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: OrgIriArgs,
    ): Promise<OrganizationEntity[]> {
        const records = await EntityQuery.from(this._store, OrgSchema)
            .where("users", "=", args.userIri)
            .all(ctx);
        return records.map((r) => this._toEntity(r));
    }

    /** @dataLayer — no checks here; RbacService enforces (see class doc). */
    async listAll(ctx: ServerContext, _sec: SecurityContext): Promise<OrganizationEntity[]> {
        const records = await EntityQuery.from(this._store, OrgSchema).all(ctx);
        return records.map((r) => this._toEntity(r));
    }

    /** @dataLayer — no checks here; RbacService enforces (see class doc). */
    async findByTenant(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: OrgTenantArgs,
    ): Promise<OrganizationEntity[]> {
        const records = await EntityQuery.from(this._store, OrgSchema)
            .connectedTo("tenant", args.tenantIri)
            .all(ctx);
        return records.map((r) => this._toEntity(r));
    }

    /** @dataLayer — no checks here; RbacService enforces (see class doc). */
    async update(
        ctx: ServerContext,
        sec: SecurityContext,
        args: RenameOrgArgs,
    ): Promise<OrganizationEntity | null> {
        return this._store.withTransaction(ctx, async (ctx) => {
            const existing = await this._entities.findById(ctx, OrgSchema, args.id);
            if (!existing) {
                return null;
            }
            await this._entities.update(ctx, OrgSchema, args.id, { name: args.name });
            return this.findById(ctx, sec, { id: args.id });
        });
    }

    /** @dataLayer — no checks here; RbacService enforces (see class doc). */
    async delete(ctx: ServerContext, _sec: SecurityContext, args: OrgIdArgs): Promise<void> {
        await this._entities.delete(ctx, OrgSchema, args.id);
    }

    private _toEntity(record: EntityRecord): OrganizationEntity {
        const now = new Date();
        const tenantEdge = record.edges?.tenant;
        const ownerEdge = record.edges?.owner;
        return {
            id: record.id,
            iri: iriFor("org", record.id).value,
            name: record.props.name != null ? String(record.props.name) : "",
            tenantIri: tenantEdge && "iri" in tenantEdge ? tenantEdge.iri : "",
            ownerIri: ownerEdge && "iri" in ownerEdge ? ownerEdge.iri : "",
            createdAt: record.createdAt ?? now,
            updatedAt: record.updatedAt ?? now,
        };
    }
}
