import type { TripleStore } from "@jasonscharf/data";
import type { EntityRecord } from "@jasonscharf/entities";
import { idFromIri } from "@jasonscharf/entities";
import { EntityStore } from "../../EntityStore.js";
import type { SecurityContext } from "../../SecurityContext.js";
import type { ServerContext } from "../../ServerContext.js";
import { ResourceNodeSchema } from "../schemas.generated.js";
import type { ResourceNodeEntity } from "../types.js";
import { edgeRefOf, iriFor } from "./helpers.js";

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

/**
 * Data-access layer for ResourceNode entities in the rbac bounded context.
 *
 * Repositories are the trusted persistence layer and perform NO access checks
 * by design (TRN-205); authorization is enforced one level up by RbacService.
 * The `_sec` argument is threaded for signature symmetry only.
 */
export class ResourceNodeRepository {
    private readonly _es: EntityStore;

    constructor(store: TripleStore) {
        this._es = new EntityStore(store);
    }

    /** @dataLayer — no checks here; RbacService enforces (see class doc). */
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

    /** @dataLayer — no checks here; RbacService enforces (see class doc). */
    async findById(
        ctx: ServerContext,
        sec: SecurityContext,
        args: IdArgs,
    ): Promise<ResourceNodeEntity | null> {
        const rec = await this._es.findById(ctx, ResourceNodeSchema, args.id);
        return rec ? toResource(rec) : null;
    }

    /** @dataLayer — no checks here; RbacService enforces (see class doc). */
    async findByIri(
        ctx: ServerContext,
        sec: SecurityContext,
        args: IriStrArgs,
    ): Promise<ResourceNodeEntity | null> {
        return this.findById(ctx, sec, { id: idFromIri(args.iriStr) });
    }

    /** @dataLayer — no checks here; RbacService enforces. Set the parent of a resource (replaces the existing hasParent edge). */
    async setParent(ctx: ServerContext, sec: SecurityContext, args: SetParentArgs): Promise<void> {
        await this._es.update(ctx, ResourceNodeSchema, idFromIri(args.resourceIri), {
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
