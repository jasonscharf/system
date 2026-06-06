import {
    delegatedFromIRI,
    grantExpiresAtIRI,
    grantedByIRI,
    hasPermissionIRI,
    hasPrincipalIRI,
    hasRoleIRI,
    hasScopeIRI,
    IRI,
    isDenialIRI,
    literal,
    PolicyGrantIRI,
    rbacCreatedAtIRI,
    rbacUpdatedAtIRI,
} from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { SecurityContext, ServerContext } from "@jasonscharf/server";
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

export interface GrantIriArgs {
    grantIri: string;
}

export interface FindGrantsArgs {
    principalIris: string[];
    scopeIris?: string[];
}

export class PolicyGrantRepository {
    private readonly _store: TripleStore;

    constructor(store: TripleStore) {
        this._store = store;
    }

    /** @insecure @nochecks */
    async create(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: CreateGrantInput,
    ): Promise<PolicyGrantEntity> {
        const id = newId();
        const now = new Date();
        const sub = iriFor("grant", id);
        const denial = args.isDenial ?? false;

        const quads = [
            { subject: sub, predicate: RDF_TYPE, object: PolicyGrantIRI, graph: RBAC_GRAPH },
            {
                subject: sub,
                predicate: hasPrincipalIRI,
                object: new IRI(args.principalIri),
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

        if (args.roleIri) {
            quads.push({
                subject: sub,
                predicate: hasRoleIRI,
                object: new IRI(args.roleIri),
                graph: RBAC_GRAPH,
            });
        }
        if (args.permissionIri) {
            quads.push({
                subject: sub,
                predicate: hasPermissionIRI,
                object: new IRI(args.permissionIri),
                graph: RBAC_GRAPH,
            });
        }
        if (args.scopeIri) {
            quads.push({
                subject: sub,
                predicate: hasScopeIRI,
                object: new IRI(args.scopeIri),
                graph: RBAC_GRAPH,
            });
        }
        if (args.grantedByIri) {
            quads.push({
                subject: sub,
                predicate: grantedByIRI,
                object: new IRI(args.grantedByIri),
                graph: RBAC_GRAPH,
            });
        }
        if (args.delegatedFromIri) {
            quads.push({
                subject: sub,
                predicate: delegatedFromIRI,
                object: new IRI(args.delegatedFromIri),
                graph: RBAC_GRAPH,
            });
        }
        if (args.grantExpiresAt) {
            quads.push({
                subject: sub,
                predicate: grantExpiresAtIRI,
                object: literal(args.grantExpiresAt.toISOString(), XSD_DATETIME),
                graph: RBAC_GRAPH,
            });
        }

        await this._store.insertMany(ctx, quads);

        return {
            id,
            iri: sub.value,
            principalIri: args.principalIri,
            roleIri: args.roleIri ?? null,
            permissionIri: args.permissionIri ?? null,
            scopeIri: args.scopeIri ?? null,
            grantedByIri: args.grantedByIri ?? null,
            delegatedFromIri: args.delegatedFromIri ?? null,
            grantExpiresAt: args.grantExpiresAt ?? null,
            isDenial: denial,
            createdAt: now,
            updatedAt: now,
        };
    }

    /** @insecure @nochecks Soft-delete a grant by IRI (revokes the assignment). */
    async revoke(ctx: ServerContext, _sec: SecurityContext, args: GrantIriArgs): Promise<void> {
        await this._store.delete(ctx, { subject: new IRI(args.grantIri), graph: RBAC_GRAPH });
    }

    /**
     * @insecure @nochecks
     * Find all active grants where grantPrincipal is in the given set of principal IRIs.
     * Optionally filter to grants whose grantScope is one of the provided scope IRIs
     * (or has no scope at all, i.e. system-wide).
     */
    async findForPrincipals(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: FindGrantsArgs,
    ): Promise<PolicyGrantEntity[]> {
        const results: PolicyGrantEntity[] = [];

        for (const principalIri of args.principalIris) {
            const principalEdges = await this._store.find(ctx, {
                predicate: hasPrincipalIRI,
                object: new IRI(principalIri),
                graph: RBAC_GRAPH,
            });

            for (const pe of principalEdges) {
                const grantSub = pe.subject as IRI;
                const quads = await this._store.find(ctx, { subject: grantSub, graph: RBAC_GRAPH });
                const grant = this._fromQuads(grantSub.value, quads);

                if (args.scopeIris !== undefined) {
                    if (grant.scopeIri !== null && !args.scopeIris.includes(grant.scopeIri)) {
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
            principalIri: getIri(hasPrincipalIRI) ?? "",
            roleIri: getIri(hasRoleIRI) ?? null,
            permissionIri: getIri(hasPermissionIRI) ?? null,
            scopeIri: getIri(hasScopeIRI) ?? null,
            grantedByIri: getIri(grantedByIRI) ?? null,
            delegatedFromIri: getIri(delegatedFromIRI) ?? null,
            grantExpiresAt: expiresAtStr ? new Date(expiresAtStr) : null,
            isDenial: getLit(isDenialIRI) === "true",
            createdAt: new Date(createdAtStr),
            updatedAt: new Date(getLit(rbacUpdatedAtIRI) ?? createdAtStr),
        };
    }
}
