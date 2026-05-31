import {
    IRI,
    inTenantIRI,
    literal,
    parentResourceIRI,
    ResourceNodeIRI,
    rbacCreatedAtIRI,
    rbacUpdatedAtIRI,
    resourceTypeIRI,
} from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { ServerContext } from "@jasonscharf/server";
import { RBAC_GRAPH, RDF_TYPE, XSD_DATETIME, XSD_STRING } from "../constants.js";
import type { ResourceNodeEntity } from "../types.js";
import { idFrom, iriFor, iriValue, literalValue, newId } from "./util.js";

export interface CreateResourceInput {
    resourceType: string;
    tenantId?: string;
    parentIri?: string;
}

export class ResourceNodeRepository {
    private readonly _store: TripleStore;

    constructor(store: TripleStore) {
        this._store = store;
    }

    async create(ctx: ServerContext, input: CreateResourceInput): Promise<ResourceNodeEntity> {
        const id = newId();
        const now = new Date();
        const sub = iriFor("resource", id);

        const quads = [
            { subject: sub, predicate: RDF_TYPE, object: ResourceNodeIRI, graph: RBAC_GRAPH },
            {
                subject: sub,
                predicate: resourceTypeIRI,
                object: literal(input.resourceType, XSD_STRING),
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
        if (input.parentIri) {
            quads.push({
                subject: sub,
                predicate: parentResourceIRI,
                object: new IRI(input.parentIri),
                graph: RBAC_GRAPH,
            });
        }

        await this._store.insertMany(ctx, quads);

        return {
            id,
            iri: sub.value,
            resourceType: input.resourceType,
            parentIri: input.parentIri ?? null,
            tenantId: input.tenantId ?? null,
            createdAt: now,
            updatedAt: now,
        };
    }

    async findById(ctx: ServerContext, id: string): Promise<ResourceNodeEntity | null> {
        const sub = iriFor("resource", id);
        const quads = await this._store.find(ctx, { subject: sub, graph: RBAC_GRAPH });
        return quads.length === 0 ? null : this._fromQuads(id, quads);
    }

    async findByIri(ctx: ServerContext, iriStr: string): Promise<ResourceNodeEntity | null> {
        const quads = await this._store.find(ctx, { subject: new IRI(iriStr), graph: RBAC_GRAPH });
        return quads.length === 0 ? null : this._fromQuads(idFrom(iriStr), quads);
    }

    /** Set the parent of a resource (adds a parentResource edge). */
    async setParent(ctx: ServerContext, resourceIri: string, parentIri: string): Promise<void> {
        await this._store.delete(ctx, {
            subject: new IRI(resourceIri),
            predicate: parentResourceIRI,
            graph: RBAC_GRAPH,
        });
        await this._store.insert(ctx, {
            subject: new IRI(resourceIri),
            predicate: parentResourceIRI,
            object: new IRI(parentIri),
            graph: RBAC_GRAPH,
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

        const tenantIri = getIri(inTenantIRI);
        return {
            id,
            iri: iriFor("resource", id).value,
            resourceType,
            parentIri: getIri(parentResourceIRI) ?? null,
            tenantId: tenantIri ? idFrom(tenantIri) : null,
            createdAt: new Date(createdAtStr),
            updatedAt: new Date(getLit(rbacUpdatedAtIRI) ?? createdAtStr),
        };
    }
}
