import {
    groupNameIRI,
    IRI,
    inTenantIRI,
    isSystemUserGroupIRI,
    literal,
    memberOfIRI,
    rbacCreatedAtIRI,
    rbacUpdatedAtIRI,
    UserGroupIRI,
} from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { ServerContext } from "@jasonscharf/server";
import { RBAC_GRAPH, RDF_TYPE, XSD_BOOLEAN, XSD_DATETIME, XSD_STRING } from "../constants.js";
import type { UserGroupEntity } from "../types.js";
import { idFrom, iriFor, iriValue, literalValue, newId } from "./util.js";

export class UserGroupRepository {
    private readonly _store: TripleStore;

    constructor(store: TripleStore) {
        this._store = store;
    }

    // ── CRUD ──────────────────────────────────────────────────────────────────

    async create(
        ctx: ServerContext,
        input: Pick<UserGroupEntity, "groupName" | "tenantId">,
    ): Promise<UserGroupEntity> {
        const id = newId();
        const now = new Date();
        const sub = iriFor("group", id);

        const quads = [
            { subject: sub, predicate: RDF_TYPE, object: UserGroupIRI, graph: RBAC_GRAPH },
            {
                subject: sub,
                predicate: groupNameIRI,
                object: literal(input.groupName, XSD_STRING),
                graph: RBAC_GRAPH,
            },
            {
                subject: sub,
                predicate: isSystemUserGroupIRI,
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
            groupName: input.groupName,
            isSystemGroup: false,
            tenantId: input.tenantId ?? null,
            createdAt: now,
            updatedAt: now,
        };
    }

    async findById(ctx: ServerContext, id: string): Promise<UserGroupEntity | null> {
        const sub = iriFor("group", id);
        const quads = await this._store.find(ctx, { subject: sub, graph: RBAC_GRAPH });
        return quads.length === 0 ? null : this._fromQuads(id, quads);
    }

    async findByIri(ctx: ServerContext, iriStr: string): Promise<UserGroupEntity | null> {
        const quads = await this._store.find(ctx, { subject: new IRI(iriStr), graph: RBAC_GRAPH });
        return quads.length === 0 ? null : this._fromQuads(idFrom(iriStr), quads);
    }

    /** Find a group by its human-readable name, optionally scoped to a tenant. */
    async findByName(
        ctx: ServerContext,
        name: string,
        tenantId?: string,
    ): Promise<UserGroupEntity | null> {
        const nameQuads = await this._store.find(ctx, {
            predicate: groupNameIRI,
            object: literal(name, XSD_STRING),
            graph: RBAC_GRAPH,
        });
        for (const nq of nameQuads) {
            const sub = nq.subject as IRI;
            const typeQ = await this._store.find(ctx, {
                subject: sub,
                predicate: RDF_TYPE,
                object: UserGroupIRI,
                graph: RBAC_GRAPH,
            });
            if (typeQ.length === 0) {
                continue;
            }
            const quads = await this._store.find(ctx, { subject: sub, graph: RBAC_GRAPH });
            const entity = this._fromQuads(idFrom(sub.value), quads);
            if (tenantId === undefined || entity.tenantId === tenantId) {
                return entity;
            }
        }
        return null;
    }

    /** List all user groups, optionally filtered to a tenant. */
    async listAll(ctx: ServerContext, tenantId?: string): Promise<UserGroupEntity[]> {
        if (tenantId !== undefined) {
            return this.listForTenant(ctx, tenantId);
        }
        const typeQuads = await this._store.find(ctx, {
            predicate: RDF_TYPE,
            object: UserGroupIRI,
            graph: RBAC_GRAPH,
        });
        if (typeQuads.length === 0) {
            return [];
        }
        const subjects = typeQuads.map((tq) => tq.subject as IRI);
        const bySubject = await this._store.findForSubjects(ctx, subjects, RBAC_GRAPH);
        const results: UserGroupEntity[] = [];
        for (const [iriStr, quads] of bySubject) {
            if (quads.length > 0) {
                results.push(this._fromQuads(idFrom(iriStr), quads));
            }
        }
        return results;
    }

    async listForTenant(ctx: ServerContext, tenantId: string): Promise<UserGroupEntity[]> {
        const tenantNode = iriFor("tenant", tenantId);
        const tenantEdges = await this._store.find(ctx, {
            predicate: inTenantIRI,
            object: tenantNode,
            graph: RBAC_GRAPH,
        });
        if (tenantEdges.length === 0) {
            return [];
        }
        const subjects = tenantEdges.map((te) => te.subject as IRI);
        const bySubject = await this._store.findForSubjects(ctx, subjects, RBAC_GRAPH);
        const results: UserGroupEntity[] = [];
        for (const [iriStr, quads] of bySubject) {
            const isGroup = quads.some(
                (q) =>
                    (q.predicate as IRI).value === RDF_TYPE.value &&
                    (q.object as IRI).value === UserGroupIRI.value,
            );
            if (isGroup) {
                results.push(this._fromQuads(idFrom(iriStr), quads));
            }
        }
        return results;
    }

    async update(
        ctx: ServerContext,
        id: string,
        patch: { groupName?: string },
    ): Promise<UserGroupEntity | null> {
        const existing = await this.findById(ctx, id);
        if (!existing) {
            return null;
        }
        const sub = iriFor("group", id);
        const now = new Date();

        if (patch.groupName !== undefined) {
            await this._store.delete(ctx, {
                subject: sub,
                predicate: groupNameIRI,
                graph: RBAC_GRAPH,
            });
            await this._store.insert(ctx, {
                subject: sub,
                predicate: groupNameIRI,
                object: literal(patch.groupName, XSD_STRING),
                graph: RBAC_GRAPH,
            });
        }
        await this._store.delete(ctx, {
            subject: sub,
            predicate: rbacUpdatedAtIRI,
            graph: RBAC_GRAPH,
        });
        await this._store.insert(ctx, {
            subject: sub,
            predicate: rbacUpdatedAtIRI,
            object: literal(now.toISOString(), XSD_DATETIME),
            graph: RBAC_GRAPH,
        });

        return this.findById(ctx, id);
    }

    /** Soft-deletes all edges whose subject is this group (removes the group and all its memberships/grants). */
    async delete(ctx: ServerContext, id: string): Promise<void> {
        const sub = iriFor("group", id);
        await this._store.delete(ctx, { subject: sub, graph: RBAC_GRAPH });
        // Also remove any memberOf edges pointing TO this group from other principals
        await this._store.delete(ctx, {
            predicate: memberOfIRI,
            object: sub,
            graph: RBAC_GRAPH,
        });
    }

    // ── Membership ────────────────────────────────────────────────────────────

    /** Add a member to a group. The member may be any principal IRI (User, ServiceAccount, or UserGroup). */
    async addMember(ctx: ServerContext, groupIri: string, memberIri: string): Promise<void> {
        await this._store.insert(ctx, {
            subject: new IRI(memberIri),
            predicate: memberOfIRI,
            object: new IRI(groupIri),
            graph: RBAC_GRAPH,
        });
    }

    /** Remove a member from a group. */
    async removeMember(ctx: ServerContext, groupIri: string, memberIri: string): Promise<void> {
        await this._store.delete(ctx, {
            subject: new IRI(memberIri),
            predicate: memberOfIRI,
            object: new IRI(groupIri),
            graph: RBAC_GRAPH,
        });
    }

    /** List IRIs of all direct members of a group. */
    async listMembers(ctx: ServerContext, groupIri: string): Promise<string[]> {
        const quads = await this._store.find(ctx, {
            predicate: memberOfIRI,
            object: new IRI(groupIri),
            graph: RBAC_GRAPH,
        });
        return quads.map((q) => (q.subject as IRI).value);
    }

    /** List the group IRIs that a principal directly belongs to. */
    async listGroupsForPrincipal(ctx: ServerContext, principalIri: string): Promise<string[]> {
        const quads = await this._store.find(ctx, {
            subject: new IRI(principalIri),
            predicate: memberOfIRI,
            graph: RBAC_GRAPH,
        });
        return quads.map((q) => iriValue(q.object)).filter((v): v is string => v != null);
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private _fromQuads(
        id: string,
        quads: Awaited<ReturnType<TripleStore["find"]>>,
    ): UserGroupEntity {
        const getLit = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? literalValue(q.object) : undefined;
        };
        const getIri = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? iriValue(q.object) : undefined;
        };

        const groupName = getLit(groupNameIRI);
        if (groupName == null) {
            throw new Error(`UserGroupRepository: missing groupName for id "${id}"`);
        }
        const createdAtStr = getLit(rbacCreatedAtIRI);
        if (createdAtStr == null) {
            throw new Error(`UserGroupRepository: missing createdAt for id "${id}"`);
        }

        const tenantIri = getIri(inTenantIRI);
        return {
            id,
            iri: iriFor("group", id).value,
            groupName,
            isSystemGroup: getLit(isSystemUserGroupIRI) === "true",
            tenantId: tenantIri ? idFrom(tenantIri) : null,
            createdAt: new Date(createdAtStr),
            updatedAt: new Date(getLit(rbacUpdatedAtIRI) ?? createdAtStr),
        };
    }
}
