import {
    IRI,
    inheritsFromIRI,
    isInTenantIRI,
    isSystemRoleIRI,
    literal,
    RoleIRI,
    rbacCreatedAtIRI,
    rbacGrantsIRI,
    rbacUpdatedAtIRI,
    roleNameIRI,
} from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { SecurityContext, ServerContext } from "@jasonscharf/server";
import { RBAC_GRAPH, RDF_TYPE, XSD_BOOLEAN, XSD_DATETIME, XSD_STRING } from "../constants.js";
import type { RoleEntity } from "../types.js";
import { idFrom, iriFor, iriValue, literalValue, newId } from "./util.js";

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

    constructor(store: TripleStore) {
        this._store = store;
    }

    /** @insecure @nochecks */
    async create(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: Pick<RoleEntity, "roleName" | "tenantId">,
    ): Promise<RoleEntity> {
        const id = newId();
        const now = new Date();
        const sub = iriFor("role", id);

        const quads = [
            { subject: sub, predicate: RDF_TYPE, object: RoleIRI, graph: RBAC_GRAPH },
            {
                subject: sub,
                predicate: roleNameIRI,
                object: literal(args.roleName, XSD_STRING),
                graph: RBAC_GRAPH,
            },
            {
                subject: sub,
                predicate: isSystemRoleIRI,
                object: literal("false", XSD_BOOLEAN),
                graph: RBAC_GRAPH,
            },
            {
                subject: sub,
                predicate: rbacCreatedAtIRI,
                object: literal(now.toISOString(), XSD_DATETIME),
                graph: RBAC_GRAPH,
            },
            {
                subject: sub,
                predicate: rbacUpdatedAtIRI,
                object: literal(now.toISOString(), XSD_DATETIME),
                graph: RBAC_GRAPH,
            },
        ];
        if (args.tenantId) {
            quads.push({
                subject: sub,
                predicate: isInTenantIRI,
                object: iriFor("tenant", args.tenantId),
                graph: RBAC_GRAPH,
            });
        }

        await this._store.insertMany(ctx, quads);
        return {
            id,
            iri: sub.value,
            roleName: args.roleName,
            isSystemRole: false,
            tenantId: args.tenantId ?? null,
            createdAt: now,
            updatedAt: now,
        };
    }

    /** @insecure @nochecks */
    async findById(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: IdArgs,
    ): Promise<RoleEntity | null> {
        const sub = iriFor("role", args.id);
        const quads = await this._store.find(ctx, { subject: sub, graph: RBAC_GRAPH });
        return quads.length === 0 ? null : this._fromQuads(args.id, quads);
    }

    /** @insecure @nochecks */
    async findByIri(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: IriStrArgs,
    ): Promise<RoleEntity | null> {
        const quads = await this._store.find(ctx, {
            subject: new IRI(args.iriStr),
            graph: RBAC_GRAPH,
        });
        return quads.length === 0 ? null : this._fromQuads(idFrom(args.iriStr), quads);
    }

    /** @insecure @nochecks Grant a permission to a role (rbac:grants edge). */
    async addPermission(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: RolePermissionArgs,
    ): Promise<void> {
        await this._store.insert(ctx, {
            subject: new IRI(args.roleIri),
            predicate: rbacGrantsIRI,
            object: new IRI(args.permissionIri),
            graph: RBAC_GRAPH,
        });
    }

    /** @insecure @nochecks Remove a permission from a role. */
    async removePermission(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: RolePermissionArgs,
    ): Promise<void> {
        await this._store.delete(ctx, {
            subject: new IRI(args.roleIri),
            predicate: rbacGrantsIRI,
            object: new IRI(args.permissionIri),
            graph: RBAC_GRAPH,
        });
    }

    /** @insecure @nochecks List permission IRIs directly granted by this role (does not include inherited). */
    async listPermissions(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: RoleIriArgs,
    ): Promise<string[]> {
        const quads = await this._store.find(ctx, {
            subject: new IRI(args.roleIri),
            predicate: rbacGrantsIRI,
            graph: RBAC_GRAPH,
        });
        return quads.map((q) => iriValue(q.object)).filter((v): v is string => v != null);
    }

    /** @insecure @nochecks Add an inheritance relationship: roleIri inherits all permissions from parentRoleIri. */
    async addInheritance(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: RoleInheritanceArgs,
    ): Promise<void> {
        await this._store.insert(ctx, {
            subject: new IRI(args.roleIri),
            predicate: inheritsFromIRI,
            object: new IRI(args.parentRoleIri),
            graph: RBAC_GRAPH,
        });
    }

    /** @insecure @nochecks Remove an inheritance relationship. */
    async removeInheritance(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: RoleInheritanceArgs,
    ): Promise<void> {
        await this._store.delete(ctx, {
            subject: new IRI(args.roleIri),
            predicate: inheritsFromIRI,
            object: new IRI(args.parentRoleIri),
            graph: RBAC_GRAPH,
        });
    }

    /** @insecure @nochecks List parent role IRIs that this role directly inherits from. */
    async listParentRoles(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: RoleIriArgs,
    ): Promise<string[]> {
        const quads = await this._store.find(ctx, {
            subject: new IRI(args.roleIri),
            predicate: inheritsFromIRI,
            graph: RBAC_GRAPH,
        });
        return quads.map((q) => iriValue(q.object)).filter((v): v is string => v != null);
    }

    private _fromQuads(id: string, quads: Awaited<ReturnType<TripleStore["find"]>>): RoleEntity {
        const getLit = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? literalValue(q.object) : undefined;
        };
        const getIri = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? iriValue(q.object) : undefined;
        };

        const roleName = getLit(roleNameIRI);
        if (roleName == null) {
            throw new Error(`RoleRepository: missing roleName for id "${id}"`);
        }
        const createdAtStr = getLit(rbacCreatedAtIRI);
        if (createdAtStr == null) {
            throw new Error(`RoleRepository: missing createdAt for id "${id}"`);
        }

        const tenantIri = getIri(isInTenantIRI);
        return {
            id,
            iri: iriFor("role", id).value,
            roleName,
            isSystemRole: getLit(isSystemRoleIRI) === "true",
            tenantId: tenantIri ? idFrom(tenantIri) : null,
            createdAt: new Date(createdAtStr),
            updatedAt: new Date(getLit(rbacUpdatedAtIRI) ?? createdAtStr),
        };
    }
}
