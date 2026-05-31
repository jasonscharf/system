import {
    IRI,
    inheritsFromIRI,
    inTenantIRI,
    isSystemRoleIRI,
    literal,
    RoleIRI,
    rbacCreatedAtIRI,
    rbacGrantsIRI,
    rbacUpdatedAtIRI,
    roleNameIRI,
} from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { ServerContext } from "@jasonscharf/server";
import { RBAC_GRAPH, RDF_TYPE, XSD_BOOLEAN, XSD_DATETIME, XSD_STRING } from "../constants.js";
import type { RoleEntity } from "../types.js";
import { idFrom, iriFor, iriValue, literalValue, newId } from "./util.js";

export class RoleRepository {
    private readonly _store: TripleStore;

    constructor(store: TripleStore) {
        this._store = store;
    }

    async create(
        ctx: ServerContext,
        input: Pick<RoleEntity, "roleName" | "tenantId">,
    ): Promise<RoleEntity> {
        const id = newId();
        const now = new Date();
        const sub = iriFor("role", id);

        const quads = [
            { subject: sub, predicate: RDF_TYPE, object: RoleIRI, graph: RBAC_GRAPH },
            {
                subject: sub,
                predicate: roleNameIRI,
                object: literal(input.roleName, XSD_STRING),
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
        if (input.tenantId) {
            quads.push({
                subject: sub,
                predicate: inTenantIRI,
                object: iriFor("tenant", input.tenantId),
                graph: RBAC_GRAPH,
            });
        }

        await this._store.insertMany(ctx, quads);
        return {
            id,
            iri: sub.value,
            roleName: input.roleName,
            isSystemRole: false,
            tenantId: input.tenantId ?? null,
            createdAt: now,
            updatedAt: now,
        };
    }

    async findById(ctx: ServerContext, id: string): Promise<RoleEntity | null> {
        const sub = iriFor("role", id);
        const quads = await this._store.find(ctx, { subject: sub, graph: RBAC_GRAPH });
        return quads.length === 0 ? null : this._fromQuads(id, quads);
    }

    async findByIri(ctx: ServerContext, iriStr: string): Promise<RoleEntity | null> {
        const quads = await this._store.find(ctx, { subject: new IRI(iriStr), graph: RBAC_GRAPH });
        return quads.length === 0 ? null : this._fromQuads(idFrom(iriStr), quads);
    }

    /** Grant a permission to a role (rbac:grants edge). */
    async addPermission(ctx: ServerContext, roleIri: string, permissionIri: string): Promise<void> {
        await this._store.insert(ctx, {
            subject: new IRI(roleIri),
            predicate: rbacGrantsIRI,
            object: new IRI(permissionIri),
            graph: RBAC_GRAPH,
        });
    }

    /** Remove a permission from a role. */
    async removePermission(
        ctx: ServerContext,
        roleIri: string,
        permissionIri: string,
    ): Promise<void> {
        await this._store.delete(ctx, {
            subject: new IRI(roleIri),
            predicate: rbacGrantsIRI,
            object: new IRI(permissionIri),
            graph: RBAC_GRAPH,
        });
    }

    /** List permission IRIs directly granted by this role (does not include inherited). */
    async listPermissions(ctx: ServerContext, roleIri: string): Promise<string[]> {
        const quads = await this._store.find(ctx, {
            subject: new IRI(roleIri),
            predicate: rbacGrantsIRI,
            graph: RBAC_GRAPH,
        });
        return quads.map((q) => iriValue(q.object)).filter((v): v is string => v != null);
    }

    /** Add an inheritance relationship: roleIri inherits all permissions from parentRoleIri. */
    async addInheritance(
        ctx: ServerContext,
        roleIri: string,
        parentRoleIri: string,
    ): Promise<void> {
        await this._store.insert(ctx, {
            subject: new IRI(roleIri),
            predicate: inheritsFromIRI,
            object: new IRI(parentRoleIri),
            graph: RBAC_GRAPH,
        });
    }

    /** Remove an inheritance relationship. */
    async removeInheritance(
        ctx: ServerContext,
        roleIri: string,
        parentRoleIri: string,
    ): Promise<void> {
        await this._store.delete(ctx, {
            subject: new IRI(roleIri),
            predicate: inheritsFromIRI,
            object: new IRI(parentRoleIri),
            graph: RBAC_GRAPH,
        });
    }

    /** List parent role IRIs that this role directly inherits from. */
    async listParentRoles(ctx: ServerContext, roleIri: string): Promise<string[]> {
        const quads = await this._store.find(ctx, {
            subject: new IRI(roleIri),
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

        const tenantIri = getIri(inTenantIRI);
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
