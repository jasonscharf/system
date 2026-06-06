import type { TripleStore } from "@jasonscharf/data";
import type { EntityRecord } from "@jasonscharf/entities";
import {
    EntityQuery,
    EntityStore,
    type SecurityContext,
    type ServerContext,
} from "@jasonscharf/server";
import { TenantSchema } from "../schemas.generated.js";
import type { TenantEntity } from "../types.js";
import { idFrom } from "./util.js";

export interface IdArgs {
    id: string;
}

export interface IriStrArgs {
    iriStr: string;
}

export interface UpdateTenantArgs {
    id: string;
    patch: { tenantName?: string };
}

/**
 * Tenant persistence on the entity layer.  Storage, hydration, and graph scoping
 * (the RBAC graph, via TenantSchema.graphIri) are handled by EntityStore; this
 * repository just adapts to the RBAC method shape.
 */
export class TenantRepository {
    private readonly _store: TripleStore;
    private readonly _es: EntityStore;

    constructor(store: TripleStore) {
        this._store = store;
        this._es = new EntityStore(store);
    }

    get store(): TripleStore {
        return this._store;
    }

    /** @insecure @nochecks */
    async create(
        ctx: ServerContext,
        sec: SecurityContext,
        args: Pick<TenantEntity, "tenantName">,
    ): Promise<TenantEntity> {
        const rec = await this._es.create(ctx, TenantSchema, {
            tenantName: args.tenantName,
            isSystemTenant: false,
        });
        return toTenant(rec);
    }

    /** @insecure @nochecks */
    async findById(
        ctx: ServerContext,
        sec: SecurityContext,
        args: IdArgs,
    ): Promise<TenantEntity | null> {
        const rec = await this._es.findById(ctx, TenantSchema, args.id);
        return rec ? toTenant(rec) : null;
    }

    /** @insecure @nochecks */
    async findByIri(
        ctx: ServerContext,
        sec: SecurityContext,
        args: IriStrArgs,
    ): Promise<TenantEntity | null> {
        return this.findById(ctx, sec, { id: idFrom(args.iriStr) });
    }

    /** @insecure @nochecks */
    async listAll(ctx: ServerContext, sec: SecurityContext): Promise<TenantEntity[]> {
        const recs = await EntityQuery.from(this._store, TenantSchema).all(ctx);
        return recs.map(toTenant);
    }

    /** @insecure @nochecks */
    async update(
        ctx: ServerContext,
        sec: SecurityContext,
        args: UpdateTenantArgs,
    ): Promise<TenantEntity | null> {
        return this._store.withTransaction(ctx, async (txCtx) => {
            const existing = await this.findById(txCtx, sec, { id: args.id });
            if (!existing) {
                return null;
            }
            if (args.patch.tenantName !== undefined) {
                await this._es.update(txCtx, TenantSchema, args.id, {
                    tenantName: args.patch.tenantName,
                });
            }
            return this.findById(txCtx, sec, { id: args.id });
        });
    }
}

function toTenant(rec: EntityRecord): TenantEntity {
    return {
        id: rec.id,
        iri: rec.iri,
        tenantName: rec.props.tenantName as string,
        isSystemTenant: (rec.props.isSystemTenant as boolean) ?? false,
    };
}
