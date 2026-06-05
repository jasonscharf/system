import { DEFAULT_GRAPH, type DefaultGraph, type IRI } from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { EntityRecord, EntitySchema } from "@jasonscharf/entities";
import {
    EntityValidationError,
    entityIri,
    fromLiteral,
    idFromIri,
    invertPropertyMap,
    localName,
    propertyMapFor,
    RDF_TYPE,
    toLiteral,
} from "@jasonscharf/entities";
import { validate } from "@jasonscharf/gen";
import type { CollectionViewOpts } from "./CollectionView.js";
import { CollectionViewStore } from "./CollectionView.js";
import { buildServerContext, type ServerContext } from "./ServerContext.js";
import { tenantGraph, tenantGraphForInsert } from "./tenancy.js";

// ── EntityStore ───────────────────────────────────────────────────────────────

export class EntityStore {
    private _cvsInstance: CollectionViewStore | null = null;

    constructor(private readonly _store: TripleStore) {}

    /** The underlying TripleStore — for raw quad access or EntityQuery builder. */
    get store(): TripleStore {
        return this._store;
    }

    // ── Transaction helpers ───────────────────────────────────────────────────

    async inTransaction<T>(
        ctxOrFn: ServerContext | ((ctx: ServerContext) => Promise<T>),
        maybeFn?: (ctx: ServerContext) => Promise<T>,
    ): Promise<T> {
        if (typeof ctxOrFn === "function") {
            return this._store.knex.transaction(async (trx) =>
                ctxOrFn(buildServerContext(this._store, { trx })),
            );
        }
        if (!maybeFn) {
            throw new Error("inTransaction(ctx, fn): fn is required when ctx is provided");
        }
        return this._store.knex.transaction(async (trx) =>
            maybeFn({ ...ctxOrFn, trx }),
        );
    }

    private async _withTrx<T>(
        ctx: ServerContext,
        fn: (ctx: ServerContext) => Promise<T>,
    ): Promise<T> {
        return this._store.withTransaction(ctx, fn);
    }

    // ── Create ────────────────────────────────────────────────────────────────

    async create<Props extends Record<string, unknown>>(
        ctx: ServerContext,
        schema: EntitySchema<Props>,
        data: Partial<Props>,
    ): Promise<EntityRecord<Props>> {
        const withDefs = this._applyDefaults(schema, data);
        this._validate(schema, withDefs);

        const id = _newId();
        const ent = entityIri(schema.ns, localName(schema.typeIRI.value), id);

        return this._withTrx(ctx, async (txCtx) => {
            const graph = tenantGraphForInsert(txCtx, schema.graph);
            await this._store.insertMany(txCtx, [
                { subject: ent, predicate: RDF_TYPE, object: schema.typeIRI, graph },
                ...this._propQuads(ent, schema, withDefs, graph),
            ]);
            return { id, iri: ent.value, props: withDefs as Props };
        });
    }

    // ── Read ──────────────────────────────────────────────────────────────────

    async findById<Props extends Record<string, unknown>>(
        ctx: ServerContext,
        schema: EntitySchema<Props>,
        id: string,
    ): Promise<EntityRecord<Props> | null> {
        return this._withTrx(ctx, async (txCtx) => {
            const ent = entityIri(schema.ns, localName(schema.typeIRI.value), id);
            const graph = tenantGraph(txCtx, schema.graph);
            const typeQ = await this._store.find(txCtx, { subject: ent, predicate: RDF_TYPE, graph });
            if (typeQ.length === 0) {
                return null;
            }
            return this._hydrate(txCtx, schema, id, ent.value, graph);
        });
    }

    // ── Update ────────────────────────────────────────────────────────────────

    async update<Props extends Record<string, unknown>>(
        ctx: ServerContext,
        schema: EntitySchema<Props>,
        id: string,
        patch: Partial<Props>,
    ): Promise<void> {
        this._validate(schema, patch);

        const ent = entityIri(schema.ns, localName(schema.typeIRI.value), id);
        const patchEntries = Object.entries(patch).filter(
            ([propName]) => !!(schema.properties as Record<string, IRI>)[propName],
        );
        const predIris = patchEntries.map(([propName]) => {
            const iri = (schema.properties as Record<string, IRI>)[propName];
            if (iri == null) {
                throw new Error(`EntityStore.update: missing IRI for property "${propName}"`);
            }
            return iri;
        });

        return this._withTrx(ctx, async (txCtx) => {
            const filterGraph = tenantGraph(txCtx, schema.graph);
            const insertGraph = tenantGraphForInsert(txCtx, schema.graph);
            if (predIris.length > 0) {
                await this._store.deleteBySubjectPredicates(txCtx, ent, predIris, filterGraph);
            }
            const quads = patchEntries
                .filter(([, value]) => value !== undefined)
                .flatMap(([propName, value]) => {
                    const propIri = (schema.properties as Record<string, IRI>)[propName];
                    if (propIri == null) {
                        throw new Error(`EntityStore.update: missing IRI for property "${propName}"`);
                    }
                    return [{ subject: ent, predicate: propIri, object: toLiteral(value), graph: insertGraph }];
                });
            if (quads.length > 0) {
                await this._store.insertMany(txCtx, quads);
            }
        });
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    async delete(ctx: ServerContext, schema: EntitySchema, id: string): Promise<void> {
        const ent = entityIri(schema.ns, localName(schema.typeIRI.value), id);
        return this._withTrx(ctx, async (txCtx) => {
            await this._store.delete(txCtx, { subject: ent, graph: tenantGraph(txCtx, schema.graph) });
        });
    }

    // ── Collection API ────────────────────────────────────────────────────────

    async collectionGet(
        ctx: ServerContext,
        schema: EntitySchema,
        id: string,
        prop: string,
    ): Promise<unknown[]> {
        return this._withTrx(ctx, async (txCtx) => {
            const propIri = (schema.properties as Record<string, IRI>)[prop];
            if (!propIri) {
                return [];
            }
            const ent = entityIri(schema.ns, localName(schema.typeIRI.value), id);
            const quads = await this._store.findOrdered(txCtx, { subject: ent, predicate: propIri, graph: tenantGraph(txCtx, schema.graph) });
            return quads.map((q) => fromLiteral(q.object)).filter((v) => v !== undefined);
        });
    }

    async collectionPush(
        ctx: ServerContext,
        schema: EntitySchema,
        id: string,
        prop: string,
        ...values: unknown[]
    ): Promise<void> {
        const propIri = (schema.properties as Record<string, IRI>)[prop];
        if (!propIri) {
            throw new Error(`Property '${prop}' not found in schema`);
        }

        const ent = entityIri(schema.ns, localName(schema.typeIRI.value), id);

        return this._withTrx(ctx, async (txCtx) => {
            const graph = tenantGraphForInsert(txCtx, schema.graph);
            const viewIris = await this._cvs().findViewsForSource(txCtx, ent.value, propIri.value);

            await this._store.insertMany(
                txCtx,
                values.map((v) => ({ subject: ent, predicate: propIri, object: toLiteral(v), graph })),
            );
            for (const v of values) {
                for (const vIri of viewIris) {
                    await this._cvs().addItem(txCtx, vIri, String(v));
                }
            }
        });
    }

    async collectionRemove(
        ctx: ServerContext,
        schema: EntitySchema,
        id: string,
        prop: string,
        value: unknown,
    ): Promise<boolean> {
        const propIri = (schema.properties as Record<string, IRI>)[prop];
        if (!propIri) {
            return false;
        }

        const ent = entityIri(schema.ns, localName(schema.typeIRI.value), id);

        let deleted = false;
        await this._withTrx(ctx, async (txCtx) => {
            const count = await this._store.delete(txCtx, {
                subject: ent,
                predicate: propIri,
                object: toLiteral(value),
                graph: tenantGraph(txCtx, schema.graph),
            });
            deleted = count > 0;
            if (deleted) {
                const viewIris = await this._cvs().findViewsForSource(
                    txCtx,
                    ent.value,
                    propIri.value,
                );
                for (const vIri of viewIris) {
                    await this._cvs().removeItem(txCtx, vIri, String(value));
                }
            }
        });
        return deleted;
    }

    async collectionPop(
        ctx: ServerContext,
        schema: EntitySchema,
        id: string,
        prop: string,
    ): Promise<unknown> {
        const items = await this.collectionGet(ctx, schema, id, prop);
        if (items.length === 0) {
            return undefined;
        }
        const last = items[items.length - 1];
        await this.collectionRemove(ctx, schema, id, prop, last);
        return last;
    }

    async collectionSet(
        ctx: ServerContext,
        schema: EntitySchema,
        id: string,
        prop: string,
        values: unknown[],
    ): Promise<void> {
        const propIri = (schema.properties as Record<string, IRI>)[prop];
        if (!propIri) {
            throw new Error(`Property '${prop}' not found in schema`);
        }

        const ent = entityIri(schema.ns, localName(schema.typeIRI.value), id);

        return this._withTrx(ctx, async (txCtx) => {
            const filterGraph = tenantGraph(txCtx, schema.graph);
            const insertGraph = tenantGraphForInsert(txCtx, schema.graph);
            await this._store.delete(txCtx, { subject: ent, predicate: propIri, graph: filterGraph });
            if (values.length > 0) {
                await this._store.insertMany(
                    txCtx,
                    values.map((v) => ({ subject: ent, predicate: propIri, object: toLiteral(v), graph: insertGraph })),
                );
            }
            const viewIris = await this._cvs().findViewsForSource(txCtx, ent.value, propIri.value);
            for (const vIri of viewIris) {
                await this._cvs().sync(txCtx, vIri, values.map(String));
            }
        });
    }

    async collectionInsertAt(
        ctx: ServerContext,
        schema: EntitySchema,
        id: string,
        prop: string,
        index: number,
        value: unknown,
    ): Promise<void> {
        const current = await this.collectionGet(ctx, schema, id, prop);
        const clamped = Math.max(0, Math.min(index, current.length));
        current.splice(clamped, 0, value);
        await this.collectionSet(ctx, schema, id, prop, current);
    }

    // ── CollectionView convenience ────────────────────────────────────────────

    async createCollectionView(
        ctx: ServerContext,
        schema: EntitySchema,
        id: string,
        prop: string,
        opts: CollectionViewOpts = {},
    ): Promise<string> {
        const propIri = (schema.properties as Record<string, IRI>)[prop];
        if (!propIri) {
            throw new Error(`Property '${prop}' not found in schema`);
        }

        const ent = entityIri(schema.ns, localName(schema.typeIRI.value), id);
        const currentRefs = (await this.collectionGet(ctx, schema, id, prop)).map(String);

        return this._withTrx(ctx, async (txCtx) => {
            return this._cvs().create(txCtx, ent.value, propIri.value, currentRefs, opts);
        });
    }

    get views(): CollectionViewStore {
        return this._cvs();
    }

    // ── Batch helpers used by EntityQuery ─────────────────────────────────────

    async hydrateMany<Props extends Record<string, unknown>>(
        ctx: ServerContext,
        schema: EntitySchema<Props>,
        iris: string[],
    ): Promise<EntityRecord<Props>[]> {
        return this._withTrx(ctx, async (txCtx) => {
            const graph = tenantGraph(txCtx, schema.graph);
            return Promise.all(
                iris.map((iri) => {
                    const id = idFromIri(iri);
                    return this._hydrate(txCtx, schema, id, iri, graph);
                }),
            );
        });
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private _cvs(): CollectionViewStore {
        if (!this._cvsInstance) {
            this._cvsInstance = new CollectionViewStore(this._store);
        }
        return this._cvsInstance;
    }

    private async _hydrate<Props extends Record<string, unknown>>(
        ctx: ServerContext,
        schema: EntitySchema<Props>,
        id: string,
        entIri: string,
        graph?: IRI | null,
    ): Promise<EntityRecord<Props>> {
        const iriToName = invertPropertyMap(schema.properties as Record<string, IRI>);
        const entNode = { value: entIri } as IRI;
        const quads = await this._store.find(ctx, { subject: entNode, graph });

        const raw: Record<string, unknown[]> = {};
        for (const q of quads) {
            const predStr = (q.predicate as IRI).value;
            if (predStr === RDF_TYPE.value) {
                continue;
            }
            const propName = iriToName.get(predStr);
            /* v8 ignore next -- defensive: unknown predicates on entity are skipped */
            if (!propName) {
                continue;
            }
            if (!raw[propName]) {
                raw[propName] = [];
            }
            raw[propName]?.push(fromLiteral(q.object));
        }

        const props: Record<string, unknown> = {};
        for (const [k, vals] of Object.entries(raw)) {
            props[k] = vals.length === 1 ? vals[0] : vals;
        }
        return { id, iri: entIri, props: props as Props };
    }

    private _propQuads(
        ent: IRI,
        schema: EntitySchema,
        data: Record<string, unknown>,
        graph: IRI | DefaultGraph = DEFAULT_GRAPH,
    ) {
        const results: Parameters<TripleStore["insert"]>[1][] = [];
        for (const [propName, propIri] of Object.entries(schema.properties)) {
            const value = data[propName];
            if (value === undefined || value === null) {
                continue;
            }
            if (Array.isArray(value)) {
                for (const v of value) {
                    results.push({ subject: ent, predicate: propIri as IRI, object: toLiteral(v), graph });
                }
            } else {
                results.push({ subject: ent, predicate: propIri as IRI, object: toLiteral(value), graph });
            }
        }
        return results;
    }

    private _applyDefaults<Props extends Record<string, unknown>>(
        schema: EntitySchema<Props>,
        data: Partial<Props>,
    ): Record<string, unknown> {
        if (!schema.defaults) {
            return data as Record<string, unknown>;
        }
        const result = { ...data } as Record<string, unknown>;
        for (const [key, defaultVal] of Object.entries(schema.defaults)) {
            if (result[key] === undefined) {
                result[key] =
                    typeof defaultVal === "function" ? (defaultVal as () => unknown)() : defaultVal;
            }
        }
        return result;
    }

    private _validate(schema: EntitySchema, data: Record<string, unknown>): void {
        if (!schema.shape) {
            return;
        }
        const result = validate(
            data,
            schema.shape,
            propertyMapFor(schema.properties as Record<string, IRI>),
        );
        if (!result.valid) {
            throw new EntityValidationError(result.violations);
        }
    }
}

// ── Private helpers ───────────────────────────────────────────────────────────

import { randomBytes } from "node:crypto";

function _newId(): string {
    return randomBytes(16).toString("hex");
}
