import { grantsIRI, IRI, inheritsFromIRI } from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { EntityRecord } from "@jasonscharf/entities";
import { idFromIri } from "@jasonscharf/entities";
import { EntityStore } from "../../EntityStore.js";
import type { SecurityContext } from "../../SecurityContext.js";
import type { ServerContext } from "../../ServerContext.js";
import { tenantGraph, tenantGraphForInsert } from "../../tenancy.js";
import { RoleSchema } from "../schemas.generated.js";
import type { RoleEntity } from "../types.js";
import { edgeRefOf, iriFor, iriValue } from "./helpers.js";

export interface IdArgs {
    id: string;
}

export interface IriStrArgs {
    iriStr: string;
}

export interface RolePermissionArgs {
    roleIri: string;
    permissionIri: string;
}

export interface RoleIriArgs {
    roleIri: string;
}

export interface RoleInheritanceArgs {
    roleIri: string;
    parentRoleIri: string;
}

export class RoleRepository {
    private readonly _store: TripleStore;
    private readonly _es: EntityStore;

    constructor(store: TripleStore) {
        this._store = store;
        this._es = new EntityStore(store);
    }

    /** @insecure @nochecks */
    async create(
        ctx: ServerContext,
        sec: SecurityContext,
        args: { roleName: string; tenantId?: string | null },
    ): Promise<RoleEntity> {
        const rec = await this._es.create(ctx, RoleSchema, {
            roleName: args.roleName,
            isSystemRole: false,
            ...(args.tenantId ? { isInTenant: iriFor("tenant", args.tenantId).value } : {}),
        });
        return toRole(rec);
    }

    /** @insecure @nochecks */
    async findById(
        ctx: ServerContext,
        sec: SecurityContext,
        args: IdArgs,
    ): Promise<RoleEntity | null> {
        const rec = await this._es.findById(ctx, RoleSchema, args.id);
        return rec ? toRole(rec) : null;
    }

    /** @insecure @nochecks */
    async findByIri(
        ctx: ServerContext,
        sec: SecurityContext,
        args: IriStrArgs,
    ): Promise<RoleEntity | null> {
        return this.findById(ctx, sec, { id: idFromIri(args.iriStr) });
    }

    /** @insecure @nochecks Grant a permission to a role (rbac:grants edge). */
    async addPermission(
        ctx: ServerContext,
        sec: SecurityContext,
        args: RolePermissionArgs,
    ): Promise<void> {
        await this._store.insert(ctx, {
            subject: new IRI(args.roleIri),
            predicate: grantsIRI,
            object: new IRI(args.permissionIri),
            graph: tenantGraphForInsert(ctx),
        });
    }

    /** @insecure @nochecks Remove a permission from a role. */
    async removePermission(
        ctx: ServerContext,
        sec: SecurityContext,
        args: RolePermissionArgs,
    ): Promise<void> {
        await this._store.delete(ctx, {
            subject: new IRI(args.roleIri),
            predicate: grantsIRI,
            object: new IRI(args.permissionIri),
            graph: tenantGraph(ctx),
        });
    }

    /** @insecure @nochecks List permission IRIs directly granted by this role (does not include inherited). */
    async listPermissions(
        ctx: ServerContext,
        sec: SecurityContext,
        args: RoleIriArgs,
    ): Promise<string[]> {
        const quads = await this._store.find(ctx, {
            subject: new IRI(args.roleIri),
            predicate: grantsIRI,
            graph: tenantGraph(ctx),
        });
        return quads.map((q) => iriValue(q.object)).filter((v): v is string => v != null);
    }

    /** @insecure @nochecks Add an inheritance relationship: roleIri inherits all permissions from parentRoleIri. */
    async addInheritance(
        ctx: ServerContext,
        sec: SecurityContext,
        args: RoleInheritanceArgs,
    ): Promise<void> {
        await this._store.insert(ctx, {
            subject: new IRI(args.roleIri),
            predicate: inheritsFromIRI,
            object: new IRI(args.parentRoleIri),
            graph: tenantGraphForInsert(ctx),
        });
    }

    /** @insecure @nochecks Remove an inheritance relationship. */
    async removeInheritance(
        ctx: ServerContext,
        sec: SecurityContext,
        args: RoleInheritanceArgs,
    ): Promise<void> {
        await this._store.delete(ctx, {
            subject: new IRI(args.roleIri),
            predicate: inheritsFromIRI,
            object: new IRI(args.parentRoleIri),
            graph: tenantGraph(ctx),
        });
    }

    /** @insecure @nochecks List parent role IRIs that this role directly inherits from. */
    async listParentRoles(
        ctx: ServerContext,
        sec: SecurityContext,
        args: RoleIriArgs,
    ): Promise<string[]> {
        const quads = await this._store.find(ctx, {
            subject: new IRI(args.roleIri),
            predicate: inheritsFromIRI,
            graph: tenantGraph(ctx),
        });
        return quads.map((q) => iriValue(q.object)).filter((v): v is string => v != null);
    }
}

function toRole(rec: EntityRecord): RoleEntity {
    return {
        id: rec.id,
        iri: rec.iri,
        roleName: rec.props.roleName as string,
        isSystemRole: (rec.props.isSystemRole as boolean) ?? false,
        isInTenant: edgeRefOf(rec, "isInTenant"),
    };
}
