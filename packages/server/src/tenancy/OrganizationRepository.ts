import { IRI, literal } from "@jasonscharf/core";
import {
    OrganizationIRI,
    orgNameIRI,
    orgOwnerIRI,
    orgTenantIRI,
    orgUserIRI,
} from "@jasonscharf/core/tenancy";
import type { EntityTimestamps, TripleStore } from "@jasonscharf/data";
import type { SecurityContext } from "../SecurityContext.js";
import type { ServerContext } from "../ServerContext.js";
import { RDF_TYPE, TENANCY_GRAPH, XSD_ANY_URI, XSD_STRING } from "./constants.js";
import type { OrganizationEntity } from "./types.js";
import { idFrom, iriFor, newId } from "./util.js";

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

export class OrganizationRepository {
    constructor(private readonly _store: TripleStore) {}

    async create(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: CreateOrgArgs,
    ): Promise<OrganizationEntity> {
        const id = newId();
        const sub = iriFor("org", id);

        return this._store.withTransaction(ctx, async (ctx) => {
            await this._store.insertMany(ctx, [
                {
                    subject: sub,
                    predicate: RDF_TYPE,
                    object: OrganizationIRI,
                    graph: TENANCY_GRAPH,
                },
                {
                    subject: sub,
                    predicate: orgNameIRI,
                    object: literal(args.name, XSD_STRING),
                    graph: TENANCY_GRAPH,
                },
                {
                    subject: sub,
                    predicate: orgTenantIRI,
                    object: new IRI(args.tenantIri),
                    graph: TENANCY_GRAPH,
                },
                {
                    subject: sub,
                    predicate: orgOwnerIRI,
                    object: new IRI(args.ownerIri),
                    graph: TENANCY_GRAPH,
                },
            ]);

            const ts = await this._timestamps(ctx, sub);
            return {
                id,
                iri: sub.value,
                name: args.name,
                tenantIri: args.tenantIri,
                ownerIri: args.ownerIri,
                createdAt: ts.createdAt,
                updatedAt: ts.updatedAt,
            };
        });
    }

    async findById(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: OrgIdArgs,
    ): Promise<OrganizationEntity | null> {
        const sub = iriFor("org", args.id);
        const quads = await this._store.find(ctx, { subject: sub, graph: TENANCY_GRAPH });
        if (quads.length === 0) {
            return null;
        }
        return this._fromQuads(args.id, quads, await this._timestamps(ctx, sub));
    }

    async addUser(ctx: ServerContext, _sec: SecurityContext, args: OrgUserArgs): Promise<void> {
        await this._store.insert(ctx, {
            subject: iriFor("org", args.orgId),
            predicate: orgUserIRI,
            object: literal(args.userIri, XSD_ANY_URI),
            graph: TENANCY_GRAPH,
        });
    }

    async removeUser(ctx: ServerContext, _sec: SecurityContext, args: OrgUserArgs): Promise<void> {
        await this._store.delete(ctx, {
            subject: iriFor("org", args.orgId),
            predicate: orgUserIRI,
            object: literal(args.userIri, XSD_ANY_URI),
            graph: TENANCY_GRAPH,
        });
    }

    async findUsers(ctx: ServerContext, _sec: SecurityContext, args: OrgIdArgs): Promise<string[]> {
        const quads = await this._store.find(ctx, {
            subject: iriFor("org", args.id),
            predicate: orgUserIRI,
            graph: TENANCY_GRAPH,
        });
        return quads.map((q) => String((q.object as { value: string }).value));
    }

    async findByUserIri(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: OrgIriArgs,
    ): Promise<OrganizationEntity[]> {
        const quads = await this._store.find(ctx, {
            predicate: orgUserIRI,
            object: literal(args.userIri, XSD_ANY_URI),
            graph: TENANCY_GRAPH,
        });
        const entities: OrganizationEntity[] = [];
        for (const q of quads) {
            const id = idFrom((q.subject as IRI).value);
            const entity = await this.findById(ctx, _sec, { id });
            if (entity) {
                entities.push(entity);
            }
        }
        return entities;
    }

    async listAll(ctx: ServerContext, _sec: SecurityContext): Promise<OrganizationEntity[]> {
        const quads = await this._store.find(ctx, {
            predicate: RDF_TYPE,
            object: OrganizationIRI,
            graph: TENANCY_GRAPH,
        });
        const entities: OrganizationEntity[] = [];
        for (const q of quads) {
            const id = idFrom((q.subject as IRI).value);
            const entity = await this.findById(ctx, _sec, { id });
            if (entity) {
                entities.push(entity);
            }
        }
        return entities;
    }

    async findByTenant(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: OrgTenantArgs,
    ): Promise<OrganizationEntity[]> {
        const quads = await this._store.find(ctx, {
            predicate: orgTenantIRI,
            object: new IRI(args.tenantIri),
            graph: TENANCY_GRAPH,
        });
        const entities: OrganizationEntity[] = [];
        for (const q of quads) {
            const id = idFrom((q.subject as IRI).value);
            const entity = await this.findById(ctx, _sec, { id });
            if (entity) {
                entities.push(entity);
            }
        }
        return entities;
    }

    async update(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: RenameOrgArgs,
    ): Promise<OrganizationEntity | null> {
        const existing = await this.findById(ctx, _sec, { id: args.id });
        if (!existing) {
            return null;
        }

        const sub = iriFor("org", args.id);

        await this._store.delete(ctx, {
            subject: sub,
            predicate: orgNameIRI,
            graph: TENANCY_GRAPH,
        });
        await this._store.insert(ctx, {
            subject: sub,
            predicate: orgNameIRI,
            object: literal(args.name, XSD_STRING),
            graph: TENANCY_GRAPH,
        });

        return this.findById(ctx, _sec, { id: args.id });
    }

    async delete(ctx: ServerContext, _sec: SecurityContext, args: OrgIdArgs): Promise<void> {
        await this._store.delete(ctx, { subject: iriFor("org", args.id), graph: TENANCY_GRAPH });
    }

    private _now(): EntityTimestamps {
        const now = new Date();
        return { createdAt: now, updatedAt: now };
    }

    /** Entity-level timestamps from the store's DB-managed edge columns (not triples). */
    private async _timestamps(ctx: ServerContext, sub: IRI): Promise<EntityTimestamps> {
        return (
            (await this._store.entityTimestamps(ctx, [sub], TENANCY_GRAPH)).get(sub.value) ??
            this._now()
        );
    }

    private _fromQuads(
        id: string,
        quads: ReturnType<TripleStore["find"]> extends Promise<infer T> ? T : never,
        ts: EntityTimestamps,
    ): OrganizationEntity {
        const get = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q !== undefined ? String((q.object as { value: string }).value) : undefined;
        };

        return {
            id,
            iri: iriFor("org", id).value,
            name: get(orgNameIRI) ?? "",
            tenantIri: get(orgTenantIRI) ?? "",
            ownerIri: get(orgOwnerIRI) ?? "",
            createdAt: ts.createdAt,
            updatedAt: ts.updatedAt,
        };
    }
}
