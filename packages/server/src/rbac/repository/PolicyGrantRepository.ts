import { IRI } from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { EntityRecord } from "@jasonscharf/entities";
import { EntityQuery } from "../../EntityQuery.js";
import { EntityStore } from "../../EntityStore.js";
import type { SecurityContext } from "../../SecurityContext.js";
import type { ServerContext } from "../../ServerContext.js";
import { tenantGraph } from "../../tenancy.js";
import { PolicyGrantSchema } from "../schemas.generated.js";
import type { PolicyGrantEntity } from "../types.js";
import { edgeRefOf } from "./helpers.js";

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
    private readonly _es: EntityStore;

    constructor(store: TripleStore) {
        this._store = store;
        this._es = new EntityStore(store);
    }

    /** @insecure @nochecks */
    async create(
        ctx: ServerContext,
        sec: SecurityContext,
        args: CreateGrantInput,
    ): Promise<PolicyGrantEntity> {
        const rec = await this._es.create(ctx, PolicyGrantSchema, {
            isDenial: args.isDenial ?? false,
            hasPrincipal: args.principalIri,
            ...(args.grantExpiresAt ? { grantExpiresAt: args.grantExpiresAt } : {}),
            ...(args.roleIri ? { hasRole: args.roleIri } : {}),
            ...(args.permissionIri ? { hasPermission: args.permissionIri } : {}),
            ...(args.scopeIri ? { hasScope: args.scopeIri } : {}),
            ...(args.grantedByIri ? { grantedBy: args.grantedByIri } : {}),
            ...(args.delegatedFromIri ? { delegatedFrom: args.delegatedFromIri } : {}),
        });
        return toGrant(rec);
    }

    /** @insecure @nochecks Soft-delete a grant by IRI (revokes the assignment). */
    async revoke(ctx: ServerContext, sec: SecurityContext, args: GrantIriArgs): Promise<void> {
        await this._store.delete(ctx, { subject: new IRI(args.grantIri), graph: tenantGraph(ctx) });
    }

    /**
     * @insecure @nochecks
     * Find all active grants whose hasPrincipal is in the given principal set.
     * Optionally restrict to grants whose hasScope is one of the provided scope
     * IRIs (or has no scope, i.e. system-wide).  One reverse edge query, no loop.
     */
    async findForPrincipals(
        ctx: ServerContext,
        sec: SecurityContext,
        args: FindGrantsArgs,
    ): Promise<PolicyGrantEntity[]> {
        const recs = await EntityQuery.from(this._store, PolicyGrantSchema)
            .connectedToAny("hasPrincipal", args.principalIris)
            .all(ctx);

        const grants = recs.map(toGrant);
        if (args.scopeIris === undefined) {
            return grants;
        }
        return grants.filter((g) => {
            const scopeIri = g.hasScope?.iri ?? null;
            return scopeIri === null || args.scopeIris?.includes(scopeIri);
        });
    }
}

function toGrant(rec: EntityRecord): PolicyGrantEntity {
    return {
        id: rec.id,
        iri: rec.iri,
        hasPrincipal: edgeRefOf(rec, "hasPrincipal"),
        hasRole: edgeRefOf(rec, "hasRole"),
        hasPermission: edgeRefOf(rec, "hasPermission"),
        hasScope: edgeRefOf(rec, "hasScope"),
        grantedBy: edgeRefOf(rec, "grantedBy"),
        delegatedFrom: edgeRefOf(rec, "delegatedFrom"),
        grantExpiresAt: (rec.props.grantExpiresAt as Date) ?? null,
        isDenial: (rec.props.isDenial as boolean) ?? false,
    };
}
