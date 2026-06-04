import { IRI, literal, PermissionIRI, permissionKeyIRI, rbacCreatedAtIRI } from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { SecurityContext, ServerContext } from "@jasonscharf/server";
import { RBAC_GRAPH, RDF_TYPE, XSD_DATETIME, XSD_STRING } from "../constants.js";
import type { PermissionEntity } from "../types.js";
import { idFrom, iriFor, literalValue, newId } from "./util.js";

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

    constructor(store: TripleStore) {
        this._store = store;
    }

    /** @insecure @nochecks */
    async create(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: Pick<PermissionEntity, "permissionKey">,
    ): Promise<PermissionEntity> {
        const id = newId();
        const now = new Date();
        const sub = iriFor("permission", id);

        await this._store.insertMany(ctx, [
            { subject: sub, predicate: RDF_TYPE, object: PermissionIRI, graph: RBAC_GRAPH },
            {
                subject: sub,
                predicate: permissionKeyIRI,
                object: literal(args.permissionKey, XSD_STRING),
                graph: RBAC_GRAPH,
            },
            {
                subject: sub,
                predicate: rbacCreatedAtIRI,
                object: literal(now.toISOString(), XSD_DATETIME),
                graph: RBAC_GRAPH,
            },
        ]);

        return { id, iri: sub.value, permissionKey: args.permissionKey, createdAt: now };
    }

    /** @insecure @nochecks */
    async findById(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: IdArgs,
    ): Promise<PermissionEntity | null> {
        const sub = iriFor("permission", args.id);
        const quads = await this._store.find(ctx, { subject: sub, graph: RBAC_GRAPH });
        return quads.length === 0 ? null : this._fromQuads(args.id, quads);
    }

    /** @insecure @nochecks */
    async findByIri(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: IriStrArgs,
    ): Promise<PermissionEntity | null> {
        const quads = await this._store.find(ctx, {
            subject: new IRI(args.iriStr),
            graph: RBAC_GRAPH,
        });
        return quads.length === 0 ? null : this._fromQuads(idFrom(args.iriStr), quads);
    }

    /** @insecure @nochecks Find a permission by its dot-separated key (e.g. "invoice.read"). */
    async findByKey(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: KeyArgs,
    ): Promise<PermissionEntity | null> {
        const quads = await this._store.find(ctx, {
            predicate: permissionKeyIRI,
            object: literal(args.key, XSD_STRING),
            graph: RBAC_GRAPH,
        });
        if (quads.length === 0) {
            return null;
        }
        const sub = quads[0].subject as IRI;
        const all = await this._store.find(ctx, { subject: sub, graph: RBAC_GRAPH });
        return this._fromQuads(idFrom(sub.value), all);
    }

    private _fromQuads(
        id: string,
        quads: Awaited<ReturnType<TripleStore["find"]>>,
    ): PermissionEntity {
        const getLit = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? literalValue(q.object) : undefined;
        };

        const permissionKey = getLit(permissionKeyIRI);
        if (permissionKey == null) {
            throw new Error(`PermissionRepository: missing permissionKey for id "${id}"`);
        }
        return {
            id,
            iri: iriFor("permission", id).value,
            permissionKey,
            createdAt: new Date(getLit(rbacCreatedAtIRI) ?? new Date().toISOString()),
        };
    }
}
