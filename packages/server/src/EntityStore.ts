import type { IRI } from "@jasonscharf/core";
import { DEFAULT_GRAPH } from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { EntityHandle, EntityRecord, EntitySchema, PropGroupDef } from "@jasonscharf/entities";
import {
    EntityValidationError,
    entityIri,
    fromLiteral,
    idFromIri,
    invertPropertyMap,
    localName,
    pgIri,
    propertyMapFor,
    RDF_TYPE,
    TERN_HANDLE,
    TERN_PROP_GROUP,
    toLiteral,
} from "@jasonscharf/entities";
import { validate } from "@jasonscharf/gen";
import type { CollectionViewOpts } from "./CollectionView.js";
import { CollectionViewStore } from "./CollectionView.js";
import type { ServerContext } from "./ServerContext.js";

// ── EntityStore ───────────────────────────────────────────────────────────────

export class EntityStore {
    private _cvsInstance: CollectionViewStore | null = null;

    constructor(private readonly _store: TripleStore) {}

    /** The underlying TripleStore — for raw quad access or EntityQuery builder. */
    get store(): TripleStore {
        return this._store;
    }

    // ── Transaction helpers ───────────────────────────────────────────────────

    async inTransaction<T>(fn: (ctx: ServerContext) => Promise<T>): Promise<T> {
        return this._store.knex.transaction(async (trx) => fn({ trx }));
    }

    private async _withTrx<T>(
        ctx: ServerContext,
        fn: (ctx: ServerContext) => Promise<T>,
    ): Promise<T> {
        return this._store.withTransaction(ctx, fn);
    }

    // ── Create ────────────────────────────────────────────────────────────────

    async create<CoreProps extends Record<string, unknown>>(
        ctx: ServerContext,
        schema: EntitySchema<CoreProps>,
        data: Partial<CoreProps>,
    ): Promise<EntityRecord> {
        const coreGroup = schema.allGroups()[0];
        if (coreGroup == null) {
            throw new Error("EntityStore.create: schema has no groups defined");
        }
        const withDefs = this._applyDefaults(coreGroup, data);
        this._validate(coreGroup, withDefs);

        const id = _newId();
        const ent = entityIri(schema.ns, localName(schema.typeIRI.value), id);
        const pg = pgIri(ent.value, coreGroup.handle);

        return this._withTrx(ctx, async (txCtx) => {
            await this._store.insertMany(txCtx, [
                { subject: ent, predicate: RDF_TYPE, object: schema.typeIRI, graph: DEFAULT_GRAPH },
                { subject: ent, predicate: TERN_PROP_GROUP, object: pg, graph: DEFAULT_GRAPH },
                {
                    subject: pg,
                    predicate: TERN_HANDLE,
                    object: toLiteral(coreGroup.handle.toString()),
                    graph: DEFAULT_GRAPH,
                },
                ...this._propQuads(pg, coreGroup, withDefs),
            ]);
            return { id, iri: ent.value, groups: { [coreGroup.handle.id]: withDefs } };
        });
    }

    // ── PropGroup management ─────────────────────────────────────────────────

    async addGroup<Props extends Record<string, unknown>>(
        ctx: ServerContext,
        schema: EntitySchema,
        id: string,
        h: EntityHandle,
        data: Partial<Props>,
    ): Promise<void> {
        const groupDef = this._requireGroup(schema, h);
        const withDefs = this._applyDefaults(groupDef, data);
        this._validate(groupDef, withDefs);

        const ent = entityIri(schema.ns, localName(schema.typeIRI.value), id);
        const pg = pgIri(ent.value, h);

        return this._withTrx(ctx, async (txCtx) => {
            await this._store.insertMany(txCtx, [
                { subject: ent, predicate: TERN_PROP_GROUP, object: pg, graph: DEFAULT_GRAPH },
                {
                    subject: pg,
                    predicate: TERN_HANDLE,
                    object: toLiteral(h.toString()),
                    graph: DEFAULT_GRAPH,
                },
                ...this._propQuads(pg, groupDef, withDefs),
            ]);
        });
    }

    // ── Read ──────────────────────────────────────────────────────────────────

    async findById(
        ctx: ServerContext,
        schema: EntitySchema,
        id: string,
        handles: EntityHandle[] | "*",
    ): Promise<EntityRecord | null> {
        return this._withTrx(ctx, async (txCtx) => {
            const ent = entityIri(schema.ns, localName(schema.typeIRI.value), id);
            const typeQ = await this._store.find(txCtx, { subject: ent, predicate: RDF_TYPE });
            if (typeQ.length === 0) {
                return null;
            }
            return this._hydrate(txCtx, schema, id, ent.value, handles);
        });
    }

    // ── Update ────────────────────────────────────────────────────────────────

    async updateGroup<Props extends Record<string, unknown>>(
        ctx: ServerContext,
        schema: EntitySchema,
        id: string,
        h: EntityHandle,
        patch: Partial<Props>,
    ): Promise<void> {
        const groupDef = this._requireGroup(schema, h);
        this._validate(groupDef, patch);

        const ent = entityIri(schema.ns, localName(schema.typeIRI.value), id);
        const pg = pgIri(ent.value, h);

        const patchEntries = Object.entries(patch).filter(
            ([propName]) => !!(groupDef.properties as Record<string, IRI>)[propName],
        );
        const predIris = patchEntries
            .map(([propName]) => {
                const iri = (groupDef.properties as Record<string, IRI>)[propName];
                if (iri == null) {
                    throw new Error(
                        `EntityStore.updateGroup: missing IRI for property "${propName}"`,
                    );
                }
                return iri;
            })
            .filter(Boolean);

        return this._withTrx(ctx, async (txCtx) => {
            if (predIris.length > 0) {
                await this._store.deleteBySubjectPredicates(txCtx, pg, predIris);
            }
            const quads = patchEntries
                .filter(([, value]) => value !== undefined)
                .flatMap(([propName, value]) => {
                    const propIri = (groupDef.properties as Record<string, IRI>)[propName];
                    if (propIri == null) {
                        throw new Error(
                            `EntityStore.updateGroup: missing IRI for property "${propName}"`,
                        );
                    }
                    return [
                        {
                            subject: pg,
                            predicate: propIri,
                            object: toLiteral(value),
                            graph: DEFAULT_GRAPH,
                        },
                    ];
                });
            if (quads.length > 0) {
                await this._store.insertMany(txCtx, quads);
            }
        });
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    async delete(ctx: ServerContext, schema: EntitySchema, id: string): Promise<void> {
        const ent = entityIri(schema.ns, localName(schema.typeIRI.value), id);
        const pgLinks = await this._store.find(ctx, { subject: ent, predicate: TERN_PROP_GROUP });
        const pgNodes = pgLinks.map((q) => q.object as IRI);

        return this._withTrx(ctx, async (txCtx) => {
            if (pgNodes.length > 0) {
                await this._store.deleteSubjects(txCtx, pgNodes);
            }
            await this._store.delete(txCtx, { subject: ent });
        });
    }

    // ── Collection API ────────────────────────────────────────────────────────

    async collectionGet(
        ctx: ServerContext,
        schema: EntitySchema,
        id: string,
        h: EntityHandle,
        prop: string,
    ): Promise<unknown[]> {
        return this._withTrx(ctx, async (txCtx) => {
            const groupDef = this._requireGroup(schema, h);
            const propIri = (groupDef.properties as Record<string, IRI>)[prop];
            if (!propIri) {
                return [];
            }

            const ent = entityIri(schema.ns, localName(schema.typeIRI.value), id);
            const pg = pgIri(ent.value, h);
            const quads = await this._store.findOrdered(txCtx, { subject: pg, predicate: propIri });
            return quads.map((q) => fromLiteral(q.object)).filter((v) => v !== undefined);
        });
    }

    async collectionPush(
        ctx: ServerContext,
        schema: EntitySchema,
        id: string,
        h: EntityHandle,
        prop: string,
        ...values: unknown[]
    ): Promise<void> {
        const groupDef = this._requireGroup(schema, h);
        const propIri = (groupDef.properties as Record<string, IRI>)[prop];
        if (!propIri) {
            throw new Error(`Property '${prop}' not found in PropGroup '${h.id}'`);
        }

        const ent = entityIri(schema.ns, localName(schema.typeIRI.value), id);
        const pg = pgIri(ent.value, h);

        return this._withTrx(ctx, async (txCtx) => {
            const viewIris = await this._cvs().findViewsForSource(txCtx, pg.value, propIri.value);

            for (const v of values) {
                await this._store.insert(txCtx, {
                    subject: pg,
                    predicate: propIri,
                    object: toLiteral(v),
                    graph: DEFAULT_GRAPH,
                });
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
        h: EntityHandle,
        prop: string,
        value: unknown,
    ): Promise<boolean> {
        const groupDef = this._requireGroup(schema, h);
        const propIri = (groupDef.properties as Record<string, IRI>)[prop];
        if (!propIri) {
            return false;
        }

        const ent = entityIri(schema.ns, localName(schema.typeIRI.value), id);
        const pg = pgIri(ent.value, h);

        let deleted = false;
        await this._withTrx(ctx, async (txCtx) => {
            const count = await this._store.delete(txCtx, {
                subject: pg,
                predicate: propIri,
                object: toLiteral(value),
            });
            deleted = count > 0;
            if (deleted) {
                const viewIris = await this._cvs().findViewsForSource(
                    txCtx,
                    pg.value,
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
        h: EntityHandle,
        prop: string,
    ): Promise<unknown> {
        const items = await this.collectionGet(ctx, schema, id, h, prop);
        if (items.length === 0) {
            return undefined;
        }
        const last = items[items.length - 1];
        await this.collectionRemove(ctx, schema, id, h, prop, last);
        return last;
    }

    async collectionSet(
        ctx: ServerContext,
        schema: EntitySchema,
        id: string,
        h: EntityHandle,
        prop: string,
        values: unknown[],
    ): Promise<void> {
        const groupDef = this._requireGroup(schema, h);
        const propIri = (groupDef.properties as Record<string, IRI>)[prop];
        if (!propIri) {
            throw new Error(`Property '${prop}' not found in PropGroup '${h.id}'`);
        }

        const ent = entityIri(schema.ns, localName(schema.typeIRI.value), id);
        const pg = pgIri(ent.value, h);

        return this._withTrx(ctx, async (txCtx) => {
            await this._store.delete(txCtx, { subject: pg, predicate: propIri });
            for (const v of values) {
                await this._store.insert(txCtx, {
                    subject: pg,
                    predicate: propIri,
                    object: toLiteral(v),
                    graph: DEFAULT_GRAPH,
                });
            }
            const viewIris = await this._cvs().findViewsForSource(txCtx, pg.value, propIri.value);
            for (const vIri of viewIris) {
                await this._cvs().sync(txCtx, vIri, values.map(String));
            }
        });
    }

    async collectionInsertAt(
        ctx: ServerContext,
        schema: EntitySchema,
        id: string,
        h: EntityHandle,
        prop: string,
        index: number,
        value: unknown,
    ): Promise<void> {
        const current = await this.collectionGet(ctx, schema, id, h, prop);
        const clamped = Math.max(0, Math.min(index, current.length));
        current.splice(clamped, 0, value);
        await this.collectionSet(ctx, schema, id, h, prop, current);
    }

    // ── CollectionView convenience ────────────────────────────────────────────

    async createCollectionView(
        ctx: ServerContext,
        schema: EntitySchema,
        id: string,
        h: EntityHandle,
        prop: string,
        opts: CollectionViewOpts = {},
    ): Promise<string> {
        const groupDef = this._requireGroup(schema, h);
        const propIri = (groupDef.properties as Record<string, IRI>)[prop];
        if (!propIri) {
            throw new Error(`Property '${prop}' not found in PropGroup '${h.id}'`);
        }

        const ent = entityIri(schema.ns, localName(schema.typeIRI.value), id);
        const pg = pgIri(ent.value, h);
        const currentRefs = (await this.collectionGet(ctx, schema, id, h, prop)).map(String);

        return this._withTrx(ctx, async (txCtx) => {
            return this._cvs().create(txCtx, pg.value, propIri.value, currentRefs, opts);
        });
    }

    get views(): CollectionViewStore {
        return this._cvs();
    }

    // ── Batch helpers used by EntityQuery ─────────────────────────────────────

    async hydrateMany(
        ctx: ServerContext,
        schema: EntitySchema,
        iris: string[],
        handles: EntityHandle[] | "*",
    ): Promise<EntityRecord[]> {
        return this._withTrx(ctx, async (txCtx) => {
            return Promise.all(
                iris.map((iri) => {
                    const id = idFromIri(iri);
                    return this._hydrate(txCtx, schema, id, iri, handles);
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

    private async _hydrate(
        ctx: ServerContext,
        schema: EntitySchema,
        id: string,
        entIri: string,
        handles: EntityHandle[] | "*",
    ): Promise<EntityRecord> {
        const groups: Record<string, Record<string, unknown>> = {};
        const defs = schema.resolveGroups(handles);

        const pgNodes = defs.map((def) => pgIri(entIri, def.handle));
        const allQuads = await this._store.findForSubjects(ctx, pgNodes);

        for (const def of defs) {
            const pg = pgIri(entIri, def.handle);
            const quads = allQuads.get(pg.value) ?? [];
            if (quads.length === 0) {
                continue;
            }

            const iriToName = invertPropertyMap(def.properties as Record<string, IRI>);
            const raw: Record<string, unknown[]> = {};
            for (const q of quads) {
                const predStr = (q.predicate as IRI).value;
                if (predStr === TERN_HANDLE.value) {
                    continue;
                }
                const propName = iriToName.get(predStr);
                /* v8 ignore next -- defensive guard; PropGroup nodes only carry TERN_HANDLE and schema property predicates */
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
            groups[def.handle.id] = props;
        }
        return { id, iri: entIri, groups };
    }

    private _propQuads(pg: IRI, def: PropGroupDef, data: Record<string, unknown>) {
        const results: Parameters<TripleStore["insert"]>[1][] = [];
        for (const [propName, propIri] of Object.entries(def.properties)) {
            const value = data[propName];
            if (value === undefined || value === null) {
                continue;
            }
            if (Array.isArray(value)) {
                for (const v of value) {
                    results.push({
                        subject: pg,
                        predicate: propIri as IRI,
                        object: toLiteral(v),
                        graph: DEFAULT_GRAPH,
                    });
                }
            } else {
                results.push({
                    subject: pg,
                    predicate: propIri as IRI,
                    object: toLiteral(value),
                    graph: DEFAULT_GRAPH,
                });
            }
        }
        return results;
    }

    private _applyDefaults<T extends Record<string, unknown>>(def: PropGroupDef, data: T): T {
        if (!def.defaults) {
            return data;
        }
        const result = { ...data } as Record<string, unknown>;
        for (const [key, defaultVal] of Object.entries(def.defaults)) {
            if (result[key] === undefined) {
                result[key] =
                    typeof defaultVal === "function" ? (defaultVal as () => unknown)() : defaultVal;
            }
        }
        return result as T;
    }

    private _requireGroup(schema: EntitySchema, h: EntityHandle): PropGroupDef {
        const g = schema.group(h);
        if (!g) {
            throw new Error(`PropGroup not registered on schema: ${h.id}`);
        }
        return g;
    }

    private _validate(def: PropGroupDef, data: Record<string, unknown>): void {
        if (!def.shape) {
            return;
        }
        const result = validate(
            data,
            def.shape,
            propertyMapFor(def.properties as Record<string, IRI>),
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
