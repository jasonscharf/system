import type { TripleStore } from "@jasonscharf/data";
import type { EntityRecord } from "@jasonscharf/entities";
import { EntityStore } from "../../EntityStore.js";
import type { SecurityContext } from "../../SecurityContext.js";
import type { ServerContext } from "../../ServerContext.js";
import { ServiceAccountSchema } from "../schemas.generated.js";
import type { ServiceAccountEntity } from "../types.js";
import { edgeRefOf, idFrom, iriFor } from "./util.js";

export interface IdArgs {
    id: string;
}

export interface IriStrArgs {
    iriStr: string;
}

export class ServiceAccountRepository {
    private readonly _es: EntityStore;

    constructor(store: TripleStore) {
        this._es = new EntityStore(store);
    }

    /** @insecure @nochecks */
    async create(
        ctx: ServerContext,
        sec: SecurityContext,
        args: { serviceAccountName: string; serviceAccountToken: string; tenantId?: string | null },
    ): Promise<ServiceAccountEntity> {
        const rec = await this._es.create(ctx, ServiceAccountSchema, {
            serviceAccountName: args.serviceAccountName,
            serviceAccountToken: args.serviceAccountToken,
            serviceAccountIsActive: true,
            ...(args.tenantId ? { isInTenant: iriFor("tenant", args.tenantId).value } : {}),
        });
        return toServiceAccount(rec);
    }

    /** @insecure @nochecks */
    async findById(
        ctx: ServerContext,
        sec: SecurityContext,
        args: IdArgs,
    ): Promise<ServiceAccountEntity | null> {
        const rec = await this._es.findById(ctx, ServiceAccountSchema, args.id);
        return rec ? toServiceAccount(rec) : null;
    }

    /** @insecure @nochecks */
    async findByIri(
        ctx: ServerContext,
        sec: SecurityContext,
        args: IriStrArgs,
    ): Promise<ServiceAccountEntity | null> {
        return this.findById(ctx, sec, { id: idFrom(args.iriStr) });
    }

    /** @insecure @nochecks */
    async deactivate(ctx: ServerContext, sec: SecurityContext, args: IdArgs): Promise<void> {
        await this._es.update(ctx, ServiceAccountSchema, args.id, { serviceAccountIsActive: false });
    }
}

function toServiceAccount(rec: EntityRecord): ServiceAccountEntity {
    return {
        id: rec.id,
        iri: rec.iri,
        serviceAccountName: rec.props.serviceAccountName as string,
        serviceAccountToken: (rec.props.serviceAccountToken as string) ?? "",
        serviceAccountIsActive: (rec.props.serviceAccountIsActive as boolean) ?? false,
        isInTenant: edgeRefOf(rec, "isInTenant"),
    };
}
