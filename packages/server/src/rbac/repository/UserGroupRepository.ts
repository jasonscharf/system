import { IRI, isMemberOfIRI } from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { EntityRecord } from "@jasonscharf/entities";
import { EntityQuery } from "../../EntityQuery.js";
import { EntityStore } from "../../EntityStore.js";
import type { SecurityContext } from "../../SecurityContext.js";
import type { ServerContext } from "../../ServerContext.js";
import { tenantGraph, tenantGraphForInsert } from "../../tenancy.js";
import { UserGroupSchema } from "../schemas.generated.js";
import type { UserGroupEntity } from "../types.js";
import { edgeRefOf, idFrom, iriFor } from "./util.js";

export interface IdArgs {
    id: string;
}

export interface IriStrArgs {
    iriStr: string;
}

export interface FindByNameArgs {
    name: string;
    tenantId?: string;
}

export interface TenantFilterArgs {
    tenantId?: string;
}

export interface TenantIdArgs {
    tenantId: string;
}

export interface UpdateGroupArgs {
    id: string;
    patch: { groupName?: string };
}

export interface GroupMemberArgs {
    groupIri: string;
    memberIri: string;
}

export interface GroupIriArgs {
    groupIri: string;
}

export interface PrincipalIriArgs {
    principalIri: string;
}

export class UserGroupRepository {
    private readonly _store: TripleStore;
    private readonly _es: EntityStore;

    constructor(store: TripleStore) {
        this._store = store;
        this._es = new EntityStore(store);
    }

    // ── CRUD ──────────────────────────────────────────────────────────────────

    /** @insecure @nochecks */
    async create(
        ctx: ServerContext,
        sec: SecurityContext,
        args: { groupName: string; tenantId?: string | null },
    ): Promise<UserGroupEntity> {
        const rec = await this._es.create(ctx, UserGroupSchema, {
            groupName: args.groupName,
            isSystemGroup: false,
            ...(args.tenantId ? { isInTenant: iriFor("tenant", args.tenantId).value } : {}),
        });
        return toGroup(rec);
    }

    /** @insecure @nochecks */
    async findById(
        ctx: ServerContext,
        sec: SecurityContext,
        args: IdArgs,
    ): Promise<UserGroupEntity | null> {
        const rec = await this._es.findById(ctx, UserGroupSchema, args.id);
        return rec ? toGroup(rec) : null;
    }

    /** @insecure @nochecks */
    async findByIri(
        ctx: ServerContext,
        sec: SecurityContext,
        args: IriStrArgs,
    ): Promise<UserGroupEntity | null> {
        return this.findById(ctx, sec, { id: idFrom(args.iriStr) });
    }

    /** @insecure @nochecks Find a group by its human-readable name, optionally scoped to a tenant. */
    async findByName(
        ctx: ServerContext,
        sec: SecurityContext,
        args: FindByNameArgs,
    ): Promise<UserGroupEntity | null> {
        const recs = await EntityQuery.from(this._store, UserGroupSchema)
            .where("groupName", "=", args.name)
            .all(ctx);
        for (const rec of recs) {
            const group = toGroup(rec);
            if (args.tenantId === undefined || group.isInTenant?.id === args.tenantId) {
                return group;
            }
        }
        return null;
    }

    /** @insecure @nochecks List all user groups, optionally filtered to a tenant. */
    async listAll(
        ctx: ServerContext,
        sec: SecurityContext,
        args: TenantFilterArgs = {},
    ): Promise<UserGroupEntity[]> {
        if (args.tenantId !== undefined) {
            return this.listForTenant(ctx, sec, { tenantId: args.tenantId });
        }
        const recs = await EntityQuery.from(this._store, UserGroupSchema).all(ctx);
        return recs.map(toGroup);
    }

    /** @insecure @nochecks */
    async listForTenant(
        ctx: ServerContext,
        sec: SecurityContext,
        args: TenantIdArgs,
    ): Promise<UserGroupEntity[]> {
        const recs = await EntityQuery.from(this._store, UserGroupSchema)
            .connectedTo("isInTenant", args.tenantId)
            .all(ctx);
        return recs.map(toGroup);
    }

    /** @insecure @nochecks */
    async update(
        ctx: ServerContext,
        sec: SecurityContext,
        args: UpdateGroupArgs,
    ): Promise<UserGroupEntity | null> {
        return this._store.withTransaction(ctx, async (txCtx) => {
            const existing = await this.findById(txCtx, sec, { id: args.id });
            if (!existing) {
                return null;
            }
            if (args.patch.groupName !== undefined) {
                await this._es.update(txCtx, UserGroupSchema, args.id, {
                    groupName: args.patch.groupName,
                });
            }
            return this.findById(txCtx, sec, { id: args.id });
        });
    }

    /** @insecure @nochecks Removes the group and all its membership/grant edges. */
    async delete(ctx: ServerContext, sec: SecurityContext, args: IdArgs): Promise<void> {
        return this._store.withTransaction(ctx, async (txCtx) => {
            await this._es.delete(txCtx, UserGroupSchema, args.id);
            await this._store.delete(txCtx, {
                predicate: isMemberOfIRI,
                object: iriFor("group", args.id),
                graph: tenantGraph(ctx),
            });
        });
    }

    // ── Membership (raw edges on arbitrary principal IRIs) ──────────────────────

    /** @insecure @nochecks Add a member to a group. The member may be any principal IRI. */
    async addMember(
        ctx: ServerContext,
        sec: SecurityContext,
        args: GroupMemberArgs,
    ): Promise<void> {
        await this._store.insert(ctx, {
            subject: new IRI(args.memberIri),
            predicate: isMemberOfIRI,
            object: new IRI(args.groupIri),
            graph: tenantGraphForInsert(ctx),
        });
    }

    /** @insecure @nochecks Remove a member from a group. */
    async removeMember(
        ctx: ServerContext,
        sec: SecurityContext,
        args: GroupMemberArgs,
    ): Promise<void> {
        await this._store.delete(ctx, {
            subject: new IRI(args.memberIri),
            predicate: isMemberOfIRI,
            object: new IRI(args.groupIri),
            graph: tenantGraph(ctx),
        });
    }

    /** @insecure @nochecks List IRIs of all direct members of a group. */
    async listMembers(
        ctx: ServerContext,
        sec: SecurityContext,
        args: GroupIriArgs,
    ): Promise<string[]> {
        const quads = await this._store.find(ctx, {
            predicate: isMemberOfIRI,
            object: new IRI(args.groupIri),
            graph: tenantGraph(ctx),
        });
        return quads.map((q) => (q.subject as IRI).value);
    }

    /** @insecure @nochecks List the group IRIs that a principal directly belongs to. */
    async listGroupsForPrincipal(
        ctx: ServerContext,
        sec: SecurityContext,
        args: PrincipalIriArgs,
    ): Promise<string[]> {
        const quads = await this._store.find(ctx, {
            subject: new IRI(args.principalIri),
            predicate: isMemberOfIRI,
            graph: tenantGraph(ctx),
        });
        return quads.map((q) => (q.object as IRI).value).filter((v): v is string => v != null);
    }
}

function toGroup(rec: EntityRecord): UserGroupEntity {
    return {
        id: rec.id,
        iri: rec.iri,
        groupName: rec.props.groupName as string,
        isSystemGroup: (rec.props.isSystemGroup as boolean) ?? false,
        isInTenant: edgeRefOf(rec, "isInTenant"),
    };
}
