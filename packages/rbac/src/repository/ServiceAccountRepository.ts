import {
    IRI,
    inTenantIRI,
    literal,
    rbacCreatedAtIRI,
    rbacIsActiveIRI,
    rbacUpdatedAtIRI,
    ServiceAccountIRI,
    serviceAccountNameIRI,
    serviceAccountTokenIRI,
} from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { ServerContext } from "@jasonscharf/server";
import { RBAC_GRAPH, RDF_TYPE, XSD_BOOLEAN, XSD_DATETIME, XSD_STRING } from "../constants.js";
import type { ServiceAccountEntity } from "../types.js";
import { idFrom, iriFor, iriValue, literalValue, newId } from "./util.js";

export class ServiceAccountRepository {
    private readonly _store: TripleStore;

    constructor(store: TripleStore) {
        this._store = store;
    }

    async create(
        ctx: ServerContext,
        input: Pick<
            ServiceAccountEntity,
            "serviceAccountName" | "serviceAccountToken" | "tenantId"
        >,
    ): Promise<ServiceAccountEntity> {
        const id = newId();
        const now = new Date();
        const sub = iriFor("sa", id);

        const quads = [
            { subject: sub, predicate: RDF_TYPE, object: ServiceAccountIRI, graph: RBAC_GRAPH },
            {
                subject: sub,
                predicate: serviceAccountNameIRI,
                object: literal(input.serviceAccountName, XSD_STRING),
                graph: RBAC_GRAPH,
            },
            {
                subject: sub,
                predicate: serviceAccountTokenIRI,
                object: literal(input.serviceAccountToken, XSD_STRING),
                graph: RBAC_GRAPH,
            },
            {
                subject: sub,
                predicate: rbacIsActiveIRI,
                object: literal("true", XSD_BOOLEAN),
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
            serviceAccountName: input.serviceAccountName,
            serviceAccountToken: input.serviceAccountToken,
            isActive: true,
            tenantId: input.tenantId ?? null,
            createdAt: now,
            updatedAt: now,
        };
    }

    async findById(ctx: ServerContext, id: string): Promise<ServiceAccountEntity | null> {
        const sub = iriFor("sa", id);
        const quads = await this._store.find(ctx, { subject: sub, graph: RBAC_GRAPH });
        return quads.length === 0 ? null : this._fromQuads(id, quads);
    }

    async findByIri(ctx: ServerContext, iriStr: string): Promise<ServiceAccountEntity | null> {
        const quads = await this._store.find(ctx, { subject: new IRI(iriStr), graph: RBAC_GRAPH });
        return quads.length === 0 ? null : this._fromQuads(idFrom(iriStr), quads);
    }

    async deactivate(ctx: ServerContext, id: string): Promise<void> {
        const sub = iriFor("sa", id);
        await this._store.delete(ctx, {
            subject: sub,
            predicate: rbacIsActiveIRI,
            graph: RBAC_GRAPH,
        });
        await this._store.insert(ctx, {
            subject: sub,
            predicate: rbacIsActiveIRI,
            object: literal("false", XSD_BOOLEAN),
            graph: RBAC_GRAPH,
        });
        const now = new Date();
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
    }

    private _fromQuads(
        id: string,
        quads: Awaited<ReturnType<TripleStore["find"]>>,
    ): ServiceAccountEntity {
        const getLit = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? literalValue(q.object) : undefined;
        };
        const getIri = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? iriValue(q.object) : undefined;
        };

        const serviceAccountName = getLit(serviceAccountNameIRI);
        if (serviceAccountName == null) {
            throw new Error(`ServiceAccountRepository: missing serviceAccountName for id "${id}"`);
        }
        const createdAtStr = getLit(rbacCreatedAtIRI);
        if (createdAtStr == null) {
            throw new Error(`ServiceAccountRepository: missing createdAt for id "${id}"`);
        }

        const tenantIri = getIri(inTenantIRI);
        return {
            id,
            iri: iriFor("sa", id).value,
            serviceAccountName,
            serviceAccountToken: getLit(serviceAccountTokenIRI) ?? "",
            isActive: getLit(rbacIsActiveIRI) !== "false",
            tenantId: tenantIri ? idFrom(tenantIri) : null,
            createdAt: new Date(createdAtStr),
            updatedAt: new Date(getLit(rbacUpdatedAtIRI) ?? createdAtStr),
        };
    }
}
