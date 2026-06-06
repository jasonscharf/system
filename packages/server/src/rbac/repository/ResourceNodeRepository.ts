import type { TripleStore } from "@jasonscharf/data";
import type { EntityRecord } from "@jasonscharf/entities";
import { EntityStore } from "../../EntityStore.js";
import type { SecurityContext } from "../../SecurityContext.js";
import type { ServerContext } from "../../ServerContext.js";
import { ResourceNodeSchema } from "../schemas.generated.js";
import type { ResourceNodeEntity } from "../types.js";
import { edgeRefOf, idFrom, iriFor } from "./util.js";

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
    private readonly _es: EntityStore;

    constructor(store: TripleStore) {
        this._es = new EntityStore(store);
    }

    /** @insecure @nochecks */
    async create(
        ctx: ServerContext,
        sec: SecurityContext,
        args: CreateResourceInput,
    ): Promise<ResourceNodeEntity> {
        const rec = await this._es.create(ctx, ResourceNodeSchema, {
            resourceType: args.resourceType,
            ...(args.tenantId ? { isInTenant: iriFor("tenant", args.tenantId).value } : {}),
            ...(args.parentIri ? { hasParent: args.parentIri } : {}),
        });
        return toResource(rec);
    }

    /** @insecure @nochecks */
    async findById(
        ctx: ServerContext,
        sec: SecurityContext,
        args: IdArgs,
    ): Promise<ResourceNodeEntity | null> {
        const rec = await this._es.findById(ctx, ResourceNodeSchema, args.id);
        return rec ? toResource(rec) : null;
    }

    /** @insecure @nochecks */
    async findByIri(
        ctx: ServerContext,
        sec: SecurityContext,
        args: IriStrArgs,
    ): Promise<ResourceNodeEntity | null> {
        return this.findById(ctx, sec, { id: idFrom(args.iriStr) });
    }

    /** @insecure @nochecks Set the parent of a resource (replaces the existing hasParent edge). */
    async setParent(ctx: ServerContext, sec: SecurityContext, args: SetParentArgs): Promise<void> {
        await this._es.update(ctx, ResourceNodeSchema, idFrom(args.resourceIri), {
            hasParent: args.parentIri,
        });
    }
}

function toResource(rec: EntityRecord): ResourceNodeEntity {
    return {
        id: rec.id,
        iri: rec.iri,
        resourceType: rec.props.resourceType as string,
        hasParent: edgeRefOf(rec, "hasParent"),
        isInTenant: edgeRefOf(rec, "isInTenant"),
    };
}
