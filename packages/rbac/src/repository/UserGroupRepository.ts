import {
    groupNameIRI,
    IRI,
    isInTenantIRI,
    isMemberOfIRI,
    isSystemUserGroupIRI,
    literal,
    rbacCreatedAtIRI,
    rbacUpdatedAtIRI,
    UserGroupIRI,
} from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { SecurityContext, ServerContext } from "@jasonscharf/server";
import { RBAC_GRAPH, RDF_TYPE, XSD_BOOLEAN, XSD_DATETIME, XSD_STRING } from "../constants.js";
import type { UserGroupEntity } from "../types.js";
import { idFrom, iriFor, iriValue, literalValue, newId } from "./util.js";

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

    constructor(store: TripleStore) {
        this._store = store;
    }

    // ── CRUD ──────────────────────────────────────────────────────────────────

    /** @insecure @nochecks */
    async create(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: Pick<UserGroupEntity, "groupName" | "tenantId">,
    ): Promise<UserGroupEntity> {
        const id = newId();
        const now = new Date();
        const sub = iriFor("group", id);

        const quads = [
            { subject: sub, predicate: RDF_TYPE, object: UserGroupIRI, graph: RBAC_GRAPH },
            {
                subject: sub,
                predicate: groupNameIRI,
                object: literal(args.groupName, XSD_STRING),
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
            groupName: args.groupName,
            isSystemGroup: false,
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
    ): Promise<UserGroupEntity | null> {
        const sub = iriFor("group", args.id);
        const quads = await this._store.find(ctx, { subject: sub, graph: RBAC_GRAPH });
        return quads.length === 0 ? null : this._fromQuads(args.id, quads);
    }

    /** @insecure @nochecks */
    async findByIri(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: IriStrArgs,
    ): Promise<UserGroupEntity | null> {
        const quads = await this._store.find(ctx, {
            subject: new IRI(args.iriStr),
            graph: RBAC_GRAPH,
        });
        return quads.length === 0 ? null : this._fromQuads(idFrom(args.iriStr), quads);
    }

    /** @insecure @nochecks Find a group by its human-readable name, optionally scoped to a tenant. */
    async findByName(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: FindByNameArgs,
    ): Promise<UserGroupEntity | null> {
        const nameQuads = await this._store.find(ctx, {
            predicate: groupNameIRI,
            object: literal(args.name, XSD_STRING),
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
            if (args.tenantId === undefined || entity.tenantId === args.tenantId) {
                return entity;
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

    /** @insecure @nochecks */
    async listForTenant(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: TenantIdArgs,
    ): Promise<UserGroupEntity[]> {
        const tenantNode = iriFor("tenant", args.tenantId);
        const tenantEdges = await this._store.find(ctx, {
            predicate: isInTenantIRI,
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

    /** @insecure @nochecks */
    async update(
        ctx: ServerContext,
        sec: SecurityContext,
        args: UpdateGroupArgs,
    ): Promise<UserGroupEntity | null> {
        return this._store.withTransaction(ctx, async (ctx) => {
            const existing = await this.findById(ctx, sec, { id: args.id });
            if (!existing) {
                return null;
            }
            const sub = iriFor("group", args.id);
            const now = new Date();

            if (args.patch.groupName !== undefined) {
                await this._store.delete(ctx, {
                    subject: sub,
                    predicate: groupNameIRI,
                    graph: RBAC_GRAPH,
                });
                await this._store.insert(ctx, {
                    subject: sub,
                    predicate: groupNameIRI,
                    object: literal(args.patch.groupName, XSD_STRING),
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

            return this.findById(ctx, sec, { id: args.id });
        });
    }

    /** @insecure @nochecks Removes the group and all its membership/grant edges. */
    async delete(ctx: ServerContext, _sec: SecurityContext, args: IdArgs): Promise<void> {
        return this._store.withTransaction(ctx, async (ctx) => {
            const sub = iriFor("group", args.id);
            await this._store.delete(ctx, { subject: sub, graph: RBAC_GRAPH });
            await this._store.delete(ctx, {
                predicate: isMemberOfIRI,
                object: sub,
                graph: RBAC_GRAPH,
            });
        });
    }

    // ── Membership ────────────────────────────────────────────────────────────

    /** @insecure @nochecks Add a member to a group. The member may be any principal IRI. */
    async addMember(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: GroupMemberArgs,
    ): Promise<void> {
        await this._store.insert(ctx, {
            subject: new IRI(args.memberIri),
            predicate: isMemberOfIRI,
            object: new IRI(args.groupIri),
            graph: RBAC_GRAPH,
        });
    }

    /** @insecure @nochecks Remove a member from a group. */
    async removeMember(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: GroupMemberArgs,
    ): Promise<void> {
        await this._store.delete(ctx, {
            subject: new IRI(args.memberIri),
            predicate: isMemberOfIRI,
            object: new IRI(args.groupIri),
            graph: RBAC_GRAPH,
        });
    }

    /** @insecure @nochecks List IRIs of all direct members of a group. */
    async listMembers(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: GroupIriArgs,
    ): Promise<string[]> {
        const quads = await this._store.find(ctx, {
            predicate: isMemberOfIRI,
            object: new IRI(args.groupIri),
            graph: RBAC_GRAPH,
        });
        return quads.map((q) => (q.subject as IRI).value);
    }

    /** @insecure @nochecks List the group IRIs that a principal directly belongs to. */
    async listGroupsForPrincipal(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: PrincipalIriArgs,
    ): Promise<string[]> {
        const quads = await this._store.find(ctx, {
            subject: new IRI(args.principalIri),
            predicate: isMemberOfIRI,
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

        const tenantIri = getIri(isInTenantIRI);
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
