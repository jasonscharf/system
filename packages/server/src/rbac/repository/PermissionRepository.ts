import type { TripleStore } from "@jasonscharf/data";
import type { EntityRecord } from "@jasonscharf/entities";
import { idFromIri } from "@jasonscharf/entities";
import { EntityQuery } from "../../EntityQuery.js";
import { EntityStore } from "../../EntityStore.js";
import type { SecurityContext } from "../../SecurityContext.js";
import type { ServerContext } from "../../ServerContext.js";
import { PermissionSchema } from "../schemas.generated.js";
import type { PermissionEntity } from "../types.js";

export interface IdArgs {
    id: string;
}

export interface IriStrArgs {
    iriStr: string;
}

export interface KeyArgs {
    key: string;
}

export class PermissionRepository {
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
        args: Pick<PermissionEntity, "permissionKey">,
    ): Promise<PermissionEntity> {
        const rec = await this._es.create(ctx, PermissionSchema, {
            permissionKey: args.permissionKey,
        });
        return toPermission(rec);
    }

    /** @insecure @nochecks */
    async findById(
        ctx: ServerContext,
        sec: SecurityContext,
        args: IdArgs,
    ): Promise<PermissionEntity | null> {
        const rec = await this._es.findById(ctx, PermissionSchema, args.id);
        return rec ? toPermission(rec) : null;
    }

    /** @insecure @nochecks */
    async findByIri(
        ctx: ServerContext,
        sec: SecurityContext,
        args: IriStrArgs,
    ): Promise<PermissionEntity | null> {
        return this.findById(ctx, sec, { id: idFromIri(args.iriStr) });
    }

    /** @insecure @nochecks Find a permission by its dot-separated key (e.g. "invoice.read"). */
    async findByKey(
        ctx: ServerContext,
        sec: SecurityContext,
        args: KeyArgs,
    ): Promise<PermissionEntity | null> {
        const rec = await EntityQuery.from(this._store, PermissionSchema)
            .where("permissionKey", "=", args.key)
            .first(ctx);
        return rec ? toPermission(rec) : null;
    }
}

function toPermission(rec: EntityRecord): PermissionEntity {
    return {
        id: rec.id,
        iri: rec.iri,
        permissionKey: rec.props.permissionKey as string,
    };
}
