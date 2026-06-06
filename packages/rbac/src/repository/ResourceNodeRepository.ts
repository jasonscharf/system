import {
    hasParentIRI,
    IRI,
    isInTenantIRI,
    literal,
    ResourceNodeIRI,
    rbacCreatedAtIRI,
    rbacUpdatedAtIRI,
    resourceTypeIRI,
} from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { SecurityContext, ServerContext } from "@jasonscharf/server";
import { RBAC_GRAPH, RDF_TYPE, XSD_DATETIME, XSD_STRING } from "../constants.js";
import type { ResourceNodeEntity } from "../types.js";
import { idFrom, iriFor, iriValue, literalValue, newId } from "./util.js";

export interface CreateResourceInput {
    resourceType: string;
    tenantId?: string;
    parentIri?: string;
}

export interface IdArgs {
    id: string;
}

export interface IriStrArgs {
    iriStr: string;
}

export interface SetParentArgs {
    resourceIri: string;
    parentIri: string;
}

export class ResourceNodeRepository {
    private readonly _store: TripleStore;

    constructor(store: TripleStore) {
        this._store = store;
    }

    /** @insecure @nochecks */
    async create(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: CreateResourceInput,
    ): Promise<ResourceNodeEntity> {
        const id = newId();
        const now = new Date();
        const sub = iriFor("resource", id);

        const quads = [
            { subject: sub, predicate: RDF_TYPE, object: ResourceNodeIRI, graph: RBAC_GRAPH },
            {
                subject: sub,
                predicate: resourceTypeIRI,
                object: literal(args.resourceType, XSD_STRING),
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
        if (args.parentIri) {
            quads.push({
                subject: sub,
                predicate: hasParentIRI,
                object: new IRI(args.parentIri),
                graph: RBAC_GRAPH,
            });
        }

        await this._store.insertMany(ctx, quads);

        return {
            id,
            iri: sub.value,
            resourceType: args.resourceType,
            parentIri: args.parentIri ?? null,
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
    ): Promise<ResourceNodeEntity | null> {
        const sub = iriFor("resource", args.id);
        const quads = await this._store.find(ctx, { subject: sub, graph: RBAC_GRAPH });
        return quads.length === 0 ? null : this._fromQuads(args.id, quads);
    }

    /** @insecure @nochecks */
    async findByIri(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: IriStrArgs,
    ): Promise<ResourceNodeEntity | null> {
        const quads = await this._store.find(ctx, {
            subject: new IRI(args.iriStr),
            graph: RBAC_GRAPH,
        });
        return quads.length === 0 ? null : this._fromQuads(idFrom(args.iriStr), quads);
    }

    /** @insecure @nochecks Set the parent of a resource (replaces existing parentResource edge). */
    async setParent(ctx: ServerContext, _sec: SecurityContext, args: SetParentArgs): Promise<void> {
        return this._store.withTransaction(ctx, async (ctx) => {
            await this._store.delete(ctx, {
                subject: new IRI(args.resourceIri),
                predicate: hasParentIRI,
                graph: RBAC_GRAPH,
            });
            await this._store.insert(ctx, {
                subject: new IRI(args.resourceIri),
                predicate: hasParentIRI,
                object: new IRI(args.parentIri),
                graph: RBAC_GRAPH,
            });
        });
    }

    private _fromQuads(
        id: string,
        quads: Awaited<ReturnType<TripleStore["find"]>>,
    ): ResourceNodeEntity {
        const getLit = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? literalValue(q.object) : undefined;
        };
        const getIri = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? iriValue(q.object) : undefined;
        };

        const resourceType = getLit(resourceTypeIRI);
        if (resourceType == null) {
            throw new Error(`ResourceNodeRepository: missing resourceType for id "${id}"`);
        }
        const createdAtStr = getLit(rbacCreatedAtIRI);
        if (createdAtStr == null) {
            throw new Error(`ResourceNodeRepository: missing createdAt for id "${id}"`);
        }

        const tenantIri = getIri(isInTenantIRI);
        return {
            id,
            iri: iriFor("resource", id).value,
            resourceType,
            parentIri: getIri(hasParentIRI) ?? null,
            tenantId: tenantIri ? idFrom(tenantIri) : null,
            createdAt: new Date(createdAtStr),
            updatedAt: new Date(getLit(rbacUpdatedAtIRI) ?? createdAtStr),
        };
    }
}
