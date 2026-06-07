import { type IRI, literal } from "@jasonscharf/core";
import { TenantIRI, tenantNameIRI, tenantUserIRI } from "@jasonscharf/core/tenancy";
import type { EntityTimestamps, TripleStore } from "@jasonscharf/data";
import type { SecurityContext } from "../SecurityContext.js";
import type { ServerContext } from "../ServerContext.js";
import { RDF_TYPE, TENANCY_GRAPH, XSD_ANY_URI, XSD_STRING } from "./constants.js";
import type { TenantEntity } from "./types.js";
import { idFrom, iriFor, newId } from "./util.js";

export interface CreateTenantArgs {
    name: string;
}

export interface TenantIdArgs {
    id: string;
}

export interface TenantUserArgs {
    tenantId: string;
    userIri: string;
}

export interface UpdateTenantArgs {
    id: string;
    patch: Partial<Pick<TenantEntity, "name">>;
}

export class TenantRepository {
    constructor(private readonly _store: TripleStore) {}

    async create(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: CreateTenantArgs,
    ): Promise<TenantEntity> {
        const id = newId();
        const sub = iriFor("tenant", id);

        return this._store.withTransaction(ctx, async (ctx) => {
            await this._store.insertMany(ctx, [
                { subject: sub, predicate: RDF_TYPE, object: TenantIRI, graph: TENANCY_GRAPH },
                {
                    subject: sub,
                    predicate: tenantNameIRI,
                    object: literal(args.name, XSD_STRING),
                    graph: TENANCY_GRAPH,
                },
            ]);

            const ts = await this._timestamps(ctx, sub);
            return {
                id,
                iri: sub.value,
                name: args.name,
                createdAt: ts.createdAt,
                updatedAt: ts.updatedAt,
            };
        });
    }

    async findById(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: TenantIdArgs,
    ): Promise<TenantEntity | null> {
        const sub = iriFor("tenant", args.id);
        const quads = await this._store.find(ctx, { subject: sub, graph: TENANCY_GRAPH });
        if (quads.length === 0) {
            return null;
        }
        return this._fromQuads(args.id, quads, await this._timestamps(ctx, sub));
    }

    async addUser(ctx: ServerContext, _sec: SecurityContext, args: TenantUserArgs): Promise<void> {
        await this._store.insert(ctx, {
            subject: iriFor("tenant", args.tenantId),
            predicate: tenantUserIRI,
            object: literal(args.userIri, XSD_ANY_URI),
            graph: TENANCY_GRAPH,
        });
    }

    async removeUser(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: TenantUserArgs,
    ): Promise<void> {
        await this._store.delete(ctx, {
            subject: iriFor("tenant", args.tenantId),
            predicate: tenantUserIRI,
            object: literal(args.userIri, XSD_ANY_URI),
            graph: TENANCY_GRAPH,
        });
    }

    async findUsers(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: TenantIdArgs,
    ): Promise<string[]> {
        const quads = await this._store.find(ctx, {
            subject: iriFor("tenant", args.id),
            predicate: tenantUserIRI,
            graph: TENANCY_GRAPH,
        });
        return quads.map((q) => String((q.object as { value: string }).value));
    }

    async findByUser(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: { userIri: string },
    ): Promise<TenantEntity[]> {
        const quads = await this._store.find(ctx, {
            predicate: tenantUserIRI,
            object: literal(args.userIri, XSD_ANY_URI),
            graph: TENANCY_GRAPH,
        });
        const entities: TenantEntity[] = [];
        for (const q of quads) {
            const id = idFrom((q.subject as IRI).value);
            const entity = await this.findById(ctx, _sec, { id });
            if (entity) {
                entities.push(entity);
            }
        }
        return entities;
    }

    async update(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: UpdateTenantArgs,
    ): Promise<TenantEntity | null> {
        const existing = await this.findById(ctx, _sec, { id: args.id });
        if (!existing) {
            return null;
        }

        const sub = iriFor("tenant", args.id);

        if (args.patch.name !== undefined) {
            await this._store.delete(ctx, {
                subject: sub,
                predicate: tenantNameIRI,
                graph: TENANCY_GRAPH,
            });
            await this._store.insert(ctx, {
                subject: sub,
                predicate: tenantNameIRI,
                object: literal(args.patch.name, XSD_STRING),
                graph: TENANCY_GRAPH,
            });
        }

        return this.findById(ctx, _sec, { id: args.id });
    }

    async delete(ctx: ServerContext, _sec: SecurityContext, args: TenantIdArgs): Promise<void> {
        await this._store.delete(ctx, { subject: iriFor("tenant", args.id), graph: TENANCY_GRAPH });
    }

    async listAll(ctx: ServerContext, _sec: SecurityContext): Promise<TenantEntity[]> {
        const quads = await this._store.find(ctx, {
            predicate: RDF_TYPE,
            object: TenantIRI,
            graph: TENANCY_GRAPH,
        });
        const tenantsBySubject = new Map<string, typeof quads>();
        for (const quad of quads) {
            const subjectKey = (quad.subject as IRI).value;
            const existing = tenantsBySubject.get(subjectKey) ?? [];
            existing.push(quad);
            tenantsBySubject.set(subjectKey, existing);
        }

        const subjects = [...tenantsBySubject.keys()].map((k) => ({ value: k }) as IRI);
        const tsBySubject = await this._store.entityTimestamps(ctx, subjects, TENANCY_GRAPH);

        const tenants: TenantEntity[] = [];
        for (const [subjectKey, subjectQuads] of tenantsBySubject) {
            const id = idFrom(subjectKey);
            const allQuads = subjectQuads.concat(
                await this._store.find(ctx, {
                    subject: { value: subjectKey } as IRI,
                    graph: TENANCY_GRAPH,
                }),
            );
            tenants.push(this._fromQuads(id, allQuads, tsBySubject.get(subjectKey) ?? this._now()));
        }
        return tenants;
    }

    private _now(): EntityTimestamps {
        const now = new Date();
        return { createdAt: now, updatedAt: now };
    }

    /** Entity-level timestamps from the store's DB-managed edge columns (not triples). */
    private async _timestamps(ctx: ServerContext, sub: IRI): Promise<EntityTimestamps> {
        return (
            (await this._store.entityTimestamps(ctx, [sub], TENANCY_GRAPH)).get(sub.value) ??
            this._now()
        );
    }

    private _fromQuads(
        id: string,
        quads: ReturnType<TripleStore["find"]> extends Promise<infer T> ? T : never,
        ts: EntityTimestamps,
    ): TenantEntity {
        const get = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q !== undefined ? String((q.object as { value: string }).value) : undefined;
        };

        return {
            id,
            iri: iriFor("tenant", id).value,
            name: get(tenantNameIRI) ?? "",
            createdAt: ts.createdAt,
            updatedAt: ts.updatedAt,
        };
    }
}
