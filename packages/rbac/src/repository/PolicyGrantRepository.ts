import {
    delegatedFromIRI,
    grantExpiresAtIRI,
    grantedByIRI,
    grantPermissionIRI,
    grantPrincipalIRI,
    grantRoleIRI,
    grantScopeIRI,
    IRI,
    isDenialIRI,
    literal,
    PolicyGrantIRI,
    rbacCreatedAtIRI,
    rbacUpdatedAtIRI,
} from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { ServerContext } from "@jasonscharf/server";
import { RBAC_GRAPH, RDF_TYPE, XSD_BOOLEAN, XSD_DATETIME } from "../constants.js";
import type { PolicyGrantEntity } from "../types.js";
import { iriFor, iriValue, literalValue, newId } from "./util.js";

export interface CreateGrantInput {
    principalIri: string;
    roleIri?: string;
    permissionIri?: string;
    scopeIri?: string;
    grantedByIri?: string;
    delegatedFromIri?: string;
    grantExpiresAt?: Date;
    isDenial?: boolean;
}

export class PolicyGrantRepository {
    private readonly _store: TripleStore;

    constructor(store: TripleStore) {
        this._store = store;
    }

    async create(ctx: ServerContext, input: CreateGrantInput): Promise<PolicyGrantEntity> {
        const id = newId();
        const now = new Date();
        const sub = iriFor("grant", id);
        const denial = input.isDenial ?? false;

        const quads = [
            { subject: sub, predicate: RDF_TYPE, object: PolicyGrantIRI, graph: RBAC_GRAPH },
            {
                subject: sub,
                predicate: grantPrincipalIRI,
                object: new IRI(input.principalIri),
                graph: RBAC_GRAPH,
            },
            {
                subject: sub,
                predicate: isDenialIRI,
                object: literal(String(denial), XSD_BOOLEAN),
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

        if (input.roleIri) {
            quads.push({
                subject: sub,
                predicate: grantRoleIRI,
                object: new IRI(input.roleIri),
                graph: RBAC_GRAPH,
            });
        }
        if (input.permissionIri) {
            quads.push({
                subject: sub,
                predicate: grantPermissionIRI,
                object: new IRI(input.permissionIri),
                graph: RBAC_GRAPH,
            });
        }
        if (input.scopeIri) {
            quads.push({
                subject: sub,
                predicate: grantScopeIRI,
                object: new IRI(input.scopeIri),
                graph: RBAC_GRAPH,
            });
        }
        if (input.grantedByIri) {
            quads.push({
                subject: sub,
                predicate: grantedByIRI,
                object: new IRI(input.grantedByIri),
                graph: RBAC_GRAPH,
            });
        }
        if (input.delegatedFromIri) {
            quads.push({
                subject: sub,
                predicate: delegatedFromIRI,
                object: new IRI(input.delegatedFromIri),
                graph: RBAC_GRAPH,
            });
        }
        if (input.grantExpiresAt) {
            quads.push({
                subject: sub,
                predicate: grantExpiresAtIRI,
                object: literal(input.grantExpiresAt.toISOString(), XSD_DATETIME),
                graph: RBAC_GRAPH,
            });
        }

        await this._store.insertMany(ctx, quads);

        return {
            id,
            iri: sub.value,
            principalIri: input.principalIri,
            roleIri: input.roleIri ?? null,
            permissionIri: input.permissionIri ?? null,
            scopeIri: input.scopeIri ?? null,
            grantedByIri: input.grantedByIri ?? null,
            delegatedFromIri: input.delegatedFromIri ?? null,
            grantExpiresAt: input.grantExpiresAt ?? null,
            isDenial: denial,
            createdAt: now,
            updatedAt: now,
        };
    }

    /** Soft-delete a grant by IRI (revokes the assignment). */
    async revoke(ctx: ServerContext, grantIri: string): Promise<void> {
        await this._store.delete(ctx, { subject: new IRI(grantIri), graph: RBAC_GRAPH });
    }

    /**
     * Find all active grants where grantPrincipal is in the given set of principal IRIs.
     * Optionally filter to grants whose grantScope is one of the provided scope IRIs
     * (or has no scope at all, i.e. system-wide).
     */
    async findForPrincipals(
        ctx: ServerContext,
        principalIris: string[],
        scopeIris?: string[],
    ): Promise<PolicyGrantEntity[]> {
        const results: PolicyGrantEntity[] = [];

        for (const principalIri of principalIris) {
            const principalEdges = await this._store.find(ctx, {
                predicate: grantPrincipalIRI,
                object: new IRI(principalIri),
                graph: RBAC_GRAPH,
            });

            for (const pe of principalEdges) {
                const grantSub = pe.subject as IRI;
                const quads = await this._store.find(ctx, { subject: grantSub, graph: RBAC_GRAPH });
                const grant = this._fromQuads(grantSub.value, quads);

                // If scopeIris provided, include only grants matching those scopes or no scope
                if (scopeIris !== undefined) {
                    if (grant.scopeIri !== null && !scopeIris.includes(grant.scopeIri)) {
                        continue;
                    }
                }

                results.push(grant);
            }
        }

        return results;
    }

    private _fromQuads(
        grantIri: string,
        quads: Awaited<ReturnType<TripleStore["find"]>>,
    ): PolicyGrantEntity {
        const getLit = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? literalValue(q.object) : undefined;
        };
        const getIri = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? iriValue(q.object) : undefined;
        };

        const createdAtStr = getLit(rbacCreatedAtIRI) ?? new Date().toISOString();
        const expiresAtStr = getLit(grantExpiresAtIRI);

        const lastSeg = grantIri.split("/").pop() ?? grantIri;

        return {
            id: lastSeg,
            iri: grantIri,
            principalIri: getIri(grantPrincipalIRI) ?? "",
            roleIri: getIri(grantRoleIRI) ?? null,
            permissionIri: getIri(grantPermissionIRI) ?? null,
            scopeIri: getIri(grantScopeIRI) ?? null,
            grantedByIri: getIri(grantedByIRI) ?? null,
            delegatedFromIri: getIri(delegatedFromIRI) ?? null,
            grantExpiresAt: expiresAtStr ? new Date(expiresAtStr) : null,
            isDenial: getLit(isDenialIRI) === "true",
            createdAt: new Date(createdAtStr),
            updatedAt: new Date(getLit(rbacUpdatedAtIRI) ?? createdAtStr),
        };
    }
}
