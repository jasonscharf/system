import {
    IRI,
    isSystemTenantIRI,
    literal,
    rbacCreatedAtIRI,
    rbacUpdatedAtIRI,
    TenantIRI,
    tenantNameIRI,
} from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { ServerContext } from "@jasonscharf/server";
import { RBAC_GRAPH, RDF_TYPE, XSD_BOOLEAN, XSD_DATETIME, XSD_STRING } from "../constants.js";
import type { TenantEntity } from "../types.js";
import { idFrom, iriFor, literalValue, newId } from "./util.js";

export class TenantRepository {
    private readonly _store: TripleStore;

    constructor(store: TripleStore) {
        this._store = store;
    }

    get store(): TripleStore {
        return this._store;
    }

    async create(
        ctx: ServerContext,
        input: Pick<TenantEntity, "tenantName">,
    ): Promise<TenantEntity> {
        const id = newId();
        const now = new Date();
        const sub = iriFor("tenant", id);

        await this._store.insertMany(ctx, [
            { subject: sub, predicate: RDF_TYPE, object: TenantIRI, graph: RBAC_GRAPH },
            {
                subject: sub,
                predicate: tenantNameIRI,
                object: literal(input.tenantName, XSD_STRING),
                graph: RBAC_GRAPH,
            },
            {
                subject: sub,
                predicate: isSystemTenantIRI,
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
        ]);

        return {
            id,
            iri: sub.value,
            tenantName: input.tenantName,
            isSystemTenant: false,
            createdAt: now,
            updatedAt: now,
        };
    }

    async findById(ctx: ServerContext, id: string): Promise<TenantEntity | null> {
        const sub = iriFor("tenant", id);
        const quads = await this._store.find(ctx, { subject: sub, graph: RBAC_GRAPH });
        return quads.length === 0 ? null : this._fromQuads(id, quads);
    }

    async findByIri(ctx: ServerContext, iriStr: string): Promise<TenantEntity | null> {
        const sub = new IRI(iriStr);
        const quads = await this._store.find(ctx, { subject: sub, graph: RBAC_GRAPH });
        return quads.length === 0 ? null : this._fromQuads(idFrom(iriStr), quads);
    }

    async listAll(ctx: ServerContext): Promise<TenantEntity[]> {
        const typeQuads = await this._store.find(ctx, {
            predicate: RDF_TYPE,
            object: TenantIRI,
            graph: RBAC_GRAPH,
        });
        const results: TenantEntity[] = [];
        for (const tq of typeQuads) {
            const sub = tq.subject as IRI;
            const quads = await this._store.find(ctx, { subject: sub, graph: RBAC_GRAPH });
            results.push(this._fromQuads(idFrom(sub.value), quads));
        }
        return results;
    }

    async update(
        ctx: ServerContext,
        id: string,
        patch: { tenantName?: string },
    ): Promise<TenantEntity | null> {
        const existing = await this.findById(ctx, id);
        if (!existing) {
            return null;
        }
        const sub = iriFor("tenant", id);
        const now = new Date();

        if (patch.tenantName !== undefined) {
            await this._store.delete(ctx, {
                subject: sub,
                predicate: tenantNameIRI,
                graph: RBAC_GRAPH,
            });
            await this._store.insert(ctx, {
                subject: sub,
                predicate: tenantNameIRI,
                object: literal(patch.tenantName, XSD_STRING),
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

    private _fromQuads(id: string, quads: Awaited<ReturnType<TripleStore["find"]>>): TenantEntity {
        const get = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? literalValue(q.object) : undefined;
        };

        const tenantName = get(tenantNameIRI);
        if (tenantName == null) {
            throw new Error(`TenantRepository: missing tenantName for id "${id}"`);
        }
        const createdAtStr = get(rbacCreatedAtIRI);
        if (createdAtStr == null) {
            throw new Error(`TenantRepository: missing createdAt for id "${id}"`);
        }
        return {
            id,
            iri: iriFor("tenant", id).value,
            tenantName,
            isSystemTenant: get(isSystemTenantIRI) === "true",
            createdAt: new Date(createdAtStr),
            updatedAt: new Date(get(rbacUpdatedAtIRI) ?? createdAtStr),
        };
    }
}
