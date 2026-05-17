import type { IRI } from '@system/core';
import { DEFAULT_GRAPH } from '@system/core';
import type { Knex } from '@system/data';
import { TripleStore, T, C } from '@system/data';
import { validate } from '@system/gen';
import type { EntityHandle } from './Handle.js';
import type { EntitySchema, PropGroupDef } from './EntitySchema.js';
import { EntityValidationError } from './EntityValidationError.js';
import { RDF_TYPE, TERN_PROP_GROUP, TERN_HANDLE } from './constants.js';
import {
    newId, entityIri, localName, pgIri, idFromIri,
    toLiteral, fromLiteral, invertPropertyMap, propertyMapFor,
} from './util.js';
import { CollectionViewStore } from './CollectionView.js';
import type { CollectionViewOpts } from './CollectionView.js';


// ── Application context ───────────────────────────────────────────────────────

/**
 * Minimal logger interface.  Any logger satisfying this shape (pino, winston,
 * console-based, etc.) can be placed on ApplicationContext.
 */
export interface Logger {
    debug(msg: string, meta?: Record<string, unknown>): void;
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
}

/**
 * Platform-wide application context passed to every entity write operation.
 *
 * `trx`    — an active Knex transaction; EntityStore creates + commits one
 *             automatically when absent.  Pass one from `es.inTransaction()`
 *             to chain multiple writes atomically.
 *
 * `logger` — optional structured logger.  EntityStore logs warnings here when
 *             they are relevant (e.g. missing PropGroup during delete).
 *
 * `config` — arbitrary application configuration.  Downstream consumers and
 *             extensions may read well-known keys from here (e.g. feature
 *             flags, tenant IDs, rate-limit settings).  Use module augmentation
 *             to extend this type in your application:
 *
 *             declare module '@system/entities' {
 *               interface ApplicationContext {
 *                 config?: { tenantId: string; analyticsEnabled: boolean };
 *               }
 *             }
 *
 * Usage:
 *
 *   // No explicit transaction — EntityStore creates + commits one per call:
 *   await es.create({}, UserSchema, { email: 'alice@example.com' });
 *
 *   // Shared transaction — commit/rollback controlled by the caller:
 *   await es.inTransaction(async ctx => {
 *       const user    = await es.create(ctx, UserSchema, { email: 'alice@example.com' });
 *       const device  = await es.create(ctx, UserDeviceSchema, { deviceUser: user.iri });
 *       const session = await es.create(ctx, UserSessionSchema, { sessionUser: user.iri });
 *       return { user, device, session };
 *   });
 */
export interface ApplicationContext {
    trx?:    Knex.Transaction;
    logger?: Logger;
    config?: Record<string, unknown>;
}

/** Convenience empty context — no transaction, no logger, no config. */
export const noCtx: ApplicationContext = Object.freeze({});

// ── Internal row types (mirror @system/data/schema.ts) ─────────────────────

interface NameRow { id: number; }
interface NodeRow { id: number; kind: string; name_id: number | null; value: string | null; datatype: string | null; lang: string | null; }
interface EdgeRow { id: number; subject: number; predicate: number; object: number; }

// ── Return types ──────────────────────────────────────────────────────────────

export interface EntityRecord {
    id:     string;
    iri:    string;
    /**
     * Groups keyed by handle.id string.  Each value is the hydrated prop object.
     * Collection properties (multiple quads for the same predicate) are returned
     * as arrays; scalar properties as plain values.
     */
    groups: Record<string, Record<string, unknown>>;
}

/**
 * Returns the data for a single PropGroup from an EntityRecord, narrowed to
 * the TypeScript type declared in the PropGroupDef.
 */
export function groupOf<Props extends Record<string, unknown>>(
    record: EntityRecord,
    def:    PropGroupDef<Props>,
): Props | undefined {
    return record.groups[def.handle.id] as Props | undefined;
}

// ── EntityStore ───────────────────────────────────────────────────────────────

/**
 * Entity-level CRUD on top of TripleStore.
 *
 * All write methods accept an `ApplicationContext` as the first argument:
 *   - Pass `{}` (or `noCtx`) when you don't need to chain the operation with others.
 *     EntityStore will create, use, and commit a transaction automatically.
 *   - Pass a ctx obtained from `es.inTransaction()` to chain multiple writes.
 *
 * Read methods (findById, collectionGet, hydrateMany) are always executed
 * against the base store and don't require a context.
 */
export class EntityStore {
    private _cvsInstance: CollectionViewStore | null = null;

    constructor(private readonly _store: TripleStore) {}

    /** The underlying TripleStore — for raw quad access or EntityQuery builder. */
    get store(): TripleStore { return this._store; }

    // ── Transaction helpers ───────────────────────────────────────────────────

    /**
     * Runs `fn` inside a single Knex transaction.  The ApplicationContext passed to `fn`
     * carries the transaction so every entity write inside chains atomically.
     * On success the transaction is committed; on error it is rolled back.
     */
    async inTransaction<T>(fn: (ctx: ApplicationContext) => Promise<T>): Promise<T> {
        return this._store.knex.transaction(async trx => {
            return fn({ trx: trx as unknown as Knex.Transaction });
        });
    }

    /**
     * Core helper: runs `fn` with a transactional TripleStore.
     * If ctx already contains a transaction the existing one is reused.
     * Otherwise a new transaction is created and auto-committed.
     */
    private async _withTrx<T>(
        ctx: ApplicationContext,
        fn:  (store: TripleStore, cvs: CollectionViewStore) => Promise<T>,
    ): Promise<T> {
        if (ctx.trx) {
            const store = new TripleStore(ctx.trx as unknown as Knex);
            return fn(store, new CollectionViewStore(store));
        }
        return this._store.knex.transaction(async trx => {
            const store = new TripleStore(trx as unknown as Knex);
            return fn(store, new CollectionViewStore(store));
        });
    }

    // ── Create ────────────────────────────────────────────────────────────────

    async create<CoreProps extends Record<string, unknown>>(
        ctx:    ApplicationContext,
        schema: EntitySchema<CoreProps>,
        data:   Partial<CoreProps>,
    ): Promise<EntityRecord> {
        const coreGroup = schema.allGroups()[0]!;
        const withDefs  = this._applyDefaults(coreGroup, data);
        this._validate(coreGroup, withDefs);

        const id  = newId();
        const ent = entityIri(schema.ns, localName(schema.typeIRI.value), id);
        const pg  = pgIri(ent.value, coreGroup.handle);

        return this._withTrx(ctx, async (store) => {
            await store.insertMany([
                { subject: ent, predicate: RDF_TYPE,        object: schema.typeIRI,                         graph: DEFAULT_GRAPH },
                { subject: ent, predicate: TERN_PROP_GROUP, object: pg,                                     graph: DEFAULT_GRAPH },
                { subject: pg,  predicate: TERN_HANDLE,     object: toLiteral(coreGroup.handle.toString()), graph: DEFAULT_GRAPH },
                ...this._propQuads(pg, coreGroup, withDefs),
            ]);
            return { id, iri: ent.value, groups: { [coreGroup.handle.id]: withDefs } };
        });
    }

    // ── PropGroup management ─────────────────────────────────────────────────

    async addGroup<Props extends Record<string, unknown>>(
        ctx:    ApplicationContext,
        schema: EntitySchema<any>,
        id:     string,
        h:      EntityHandle,
        data:   Partial<Props>,
    ): Promise<void> {
        const groupDef = this._requireGroup(schema, h);
        const withDefs = this._applyDefaults(groupDef, data);
        this._validate(groupDef, withDefs);

        const ent = entityIri(schema.ns, localName(schema.typeIRI.value), id);
        const pg  = pgIri(ent.value, h);

        return this._withTrx(ctx, async (store) => {
            await store.insertMany([
                { subject: ent, predicate: TERN_PROP_GROUP, object: pg,                             graph: DEFAULT_GRAPH },
                { subject: pg,  predicate: TERN_HANDLE,     object: toLiteral(h.toString()),         graph: DEFAULT_GRAPH },
                ...this._propQuads(pg, groupDef, withDefs),
            ]);
        });
    }

    // ── Read ──────────────────────────────────────────────────────────────────

    async findById(
        schema:  EntitySchema<any>,
        id:      string,
        handles: EntityHandle[] | '*',
    ): Promise<EntityRecord | null> {
        const ent   = entityIri(schema.ns, localName(schema.typeIRI.value), id);
        const typeQ = await this._store.find({ subject: ent, predicate: RDF_TYPE });
        if (typeQ.length === 0) { return null; }
        return this._hydrate(schema, id, ent.value, handles);
    }

    // ── Update ────────────────────────────────────────────────────────────────

    async updateGroup<Props extends Record<string, unknown>>(
        ctx:    ApplicationContext,
        schema: EntitySchema<any>,
        id:     string,
        h:      EntityHandle,
        patch:  Partial<Props>,
    ): Promise<void> {
        const groupDef = this._requireGroup(schema, h);
        this._validate(groupDef, patch);

        const ent = entityIri(schema.ns, localName(schema.typeIRI.value), id);
        const pg  = pgIri(ent.value, h);

        // Collect the IRI for each patched property and batch-delete them in one
        // SQL round-trip, then re-insert the new values.
        const patchEntries = Object.entries(patch).filter(([propName]) =>
            !!(groupDef.properties as Record<string, IRI>)[propName],
        );
        const predIris = patchEntries
            .map(([propName]) => (groupDef.properties as Record<string, IRI>)[propName]!)
            .filter(Boolean);

        return this._withTrx(ctx, async (store) => {
            // One DELETE for all patched predicates
            if (predIris.length > 0) {
                await store.deleteBySubjectPredicates(pg, predIris);
            }
            // One insertMany for all new values
            const quads = patchEntries
                .filter(([, value]) => value !== undefined)
                .flatMap(([propName, value]) => {
                    const propIri = (groupDef.properties as Record<string, IRI>)[propName]!;
                    return [{ subject: pg, predicate: propIri, object: toLiteral(value), graph: DEFAULT_GRAPH }];
                });
            if (quads.length > 0) { await store.insertMany(quads); }
        });
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    /** Hard-deletes the entity and all its PropGroup nodes in one transaction. */
    async delete(ctx: ApplicationContext, schema: EntitySchema<any>, id: string): Promise<void> {
        const ent     = entityIri(schema.ns, localName(schema.typeIRI.value), id);
        const pgLinks = await this._store.find({ subject: ent, predicate: TERN_PROP_GROUP });
        const pgNodes = pgLinks.map(q => q.object as IRI);

        return this._withTrx(ctx, async (store) => {
            // Batch-delete all PropGroup nodes in one SQL query
            if (pgNodes.length > 0) { await store.deleteSubjects(pgNodes); }
            // Delete the entity node itself
            await store.delete({ subject: ent });
        });
    }

    // ── Collection API ────────────────────────────────────────────────────────

    async collectionGet(
        schema: EntitySchema<any>,
        id:     string,
        h:      EntityHandle,
        prop:   string,
    ): Promise<unknown[]> {
        const groupDef = this._requireGroup(schema, h);
        const propIri  = (groupDef.properties as Record<string, IRI>)[prop];
        if (!propIri) { return []; }

        const ent      = entityIri(schema.ns, localName(schema.typeIRI.value), id);
        const pg       = pgIri(ent.value, h);
        const pgNodeId = await this._lookupNodeId(pg);
        if (pgNodeId === null) { return []; }
        const propNodeId = await this._lookupNodeId(propIri);
        if (propNodeId === null) { return []; }

        const edges = await this._store.knex(T.edges)
            .where({ [C.subject]: pgNodeId, [C.predicate]: propNodeId })
            .orderBy(C.id, 'asc')
            .select<EdgeRow[]>(C.id, C.object);

        if (edges.length === 0) { return []; }

        const objIds = edges.map(e => e.object);
        const nodes  = await this._store.knex(T.nodes)
            .whereIn(C.id, objIds)
            .select<NodeRow[]>(C.id, C.kind, 'name_id', C.value, C.datatype, C.lang);

        const nodeMap = new Map(nodes.map(n => [n.id, n]));
        return edges.map(e => this._nodeToValue(nodeMap.get(e.object))).filter(v => v !== undefined);
    }

    /** Appends one or more values to a collection property. Registered CollectionViews update automatically. */
    async collectionPush(
        ctx:    ApplicationContext,
        schema: EntitySchema<any>,
        id:     string,
        h:      EntityHandle,
        prop:   string,
        ...values: unknown[]
    ): Promise<void> {
        const groupDef = this._requireGroup(schema, h);
        const propIri  = (groupDef.properties as Record<string, IRI>)[prop];
        if (!propIri) { throw new Error(`Property '${prop}' not found in PropGroup '${h.id}'`); }

        const ent = entityIri(schema.ns, localName(schema.typeIRI.value), id);
        const pg  = pgIri(ent.value, h);

        return this._withTrx(ctx, async (store, cvs) => {
            // Find views once before the values loop — the registered views don't
            // change between iterations.
            const viewIris = await cvs.findViewsForSource(pg.value, propIri.value);

            for (const v of values) {
                await store.insert({ subject: pg, predicate: propIri, object: toLiteral(v), graph: DEFAULT_GRAPH });
                for (const vIri of viewIris) { await cvs.addItem(vIri, String(v)); }
            }
        });
    }

    /** Removes the first occurrence of a specific value from a collection. CollectionViews update automatically. */
    async collectionRemove(
        ctx:    ApplicationContext,
        schema: EntitySchema<any>,
        id:     string,
        h:      EntityHandle,
        prop:   string,
        value:  unknown,
    ): Promise<boolean> {
        const groupDef = this._requireGroup(schema, h);
        const propIri  = (groupDef.properties as Record<string, IRI>)[prop];
        if (!propIri) { return false; }

        const ent = entityIri(schema.ns, localName(schema.typeIRI.value), id);
        const pg  = pgIri(ent.value, h);

        let deleted = false;
        await this._withTrx(ctx, async (store, cvs) => {
            const count = await store.delete({ subject: pg, predicate: propIri, object: toLiteral(value) });
            deleted = count > 0;
            if (deleted) {
                const viewIris = await cvs.findViewsForSource(pg.value, propIri.value);
                for (const vIri of viewIris) { await cvs.removeItem(vIri, String(value)); }
            }
        });
        return deleted;
    }

    /** Removes and returns the last-inserted value of a collection property. */
    async collectionPop(
        ctx:    ApplicationContext,
        schema: EntitySchema<any>,
        id:     string,
        h:      EntityHandle,
        prop:   string,
    ): Promise<unknown> {
        const items = await this.collectionGet(schema, id, h, prop);
        if (items.length === 0) { return undefined; }
        const last = items[items.length - 1];
        await this.collectionRemove(ctx, schema, id, h, prop, last);
        return last;
    }

    /** Replaces the entire collection.  Use this for sorting: `collectionSet(ctx, …, sorted)`. */
    async collectionSet(
        ctx:     ApplicationContext,
        schema:  EntitySchema<any>,
        id:      string,
        h:       EntityHandle,
        prop:    string,
        values:  unknown[],
    ): Promise<void> {
        const groupDef = this._requireGroup(schema, h);
        const propIri  = (groupDef.properties as Record<string, IRI>)[prop];
        if (!propIri) { throw new Error(`Property '${prop}' not found in PropGroup '${h.id}'`); }

        const ent = entityIri(schema.ns, localName(schema.typeIRI.value), id);
        const pg  = pgIri(ent.value, h);

        return this._withTrx(ctx, async (store, cvs) => {
            // Delete all current values for the property in one query
            await store.delete({ subject: pg, predicate: propIri });
            // Re-insert in order
            for (const v of values) {
                await store.insert({ subject: pg, predicate: propIri, object: toLiteral(v), graph: DEFAULT_GRAPH });
            }
            // Sync any registered CollectionViews
            const viewIris = await cvs.findViewsForSource(pg.value, propIri.value);
            for (const vIri of viewIris) {
                await cvs.sync(vIri, values.map(String));
            }
        });
    }

    /** Inserts a value at a specific position (0-based). */
    async collectionInsertAt(
        ctx:    ApplicationContext,
        schema: EntitySchema<any>,
        id:     string,
        h:      EntityHandle,
        prop:   string,
        index:  number,
        value:  unknown,
    ): Promise<void> {
        const current = await this.collectionGet(schema, id, h, prop);
        const clamped = Math.max(0, Math.min(index, current.length));
        current.splice(clamped, 0, value);
        await this.collectionSet(ctx, schema, id, h, prop, current);
    }

    // ── CollectionView convenience ────────────────────────────────────────────

    /**
     * Creates a CollectionView over a collection property, pre-populated with
     * current items.  Future collectionPush / collectionRemove calls auto-update it.
     */
    async createCollectionView(
        ctx:    ApplicationContext,
        schema: EntitySchema<any>,
        id:     string,
        h:      EntityHandle,
        prop:   string,
        opts:   CollectionViewOpts = {},
    ): Promise<string> {
        const groupDef = this._requireGroup(schema, h);
        const propIri  = (groupDef.properties as Record<string, IRI>)[prop];
        if (!propIri) { throw new Error(`Property '${prop}' not found in PropGroup '${h.id}'`); }

        const ent         = entityIri(schema.ns, localName(schema.typeIRI.value), id);
        const pg          = pgIri(ent.value, h);
        const currentRefs = (await this.collectionGet(schema, id, h, prop)).map(String);

        return this._withTrx(ctx, async (_store, cvs) => {
            return cvs.create(pg.value, propIri.value, currentRefs, opts);
        });
    }

    /** Direct access to the CollectionViewStore for advanced view operations. */
    get views(): CollectionViewStore { return this._cvs(); }

    // ── Batch helpers used by EntityQuery ─────────────────────────────────────

    async hydrateMany(
        schema:  EntitySchema<any>,
        iris:    string[],
        handles: EntityHandle[] | '*',
    ): Promise<EntityRecord[]> {
        return Promise.all(iris.map(iri => {
            const id = idFromIri(iri);
            return this._hydrate(schema, id, iri, handles);
        }));
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private _cvs(): CollectionViewStore {
        if (!this._cvsInstance) { this._cvsInstance = new CollectionViewStore(this._store); }
        return this._cvsInstance;
    }

    private async _hydrate(
        schema:  EntitySchema<any>,
        id:      string,
        entIri:  string,
        handles: EntityHandle[] | '*',
    ): Promise<EntityRecord> {
        const groups: Record<string, Record<string, unknown>> = {};
        const defs   = schema.resolveGroups(handles);

        const pgNodes  = defs.map(def => pgIri(entIri, def.handle));
        const allQuads = await this._store.findForSubjects(pgNodes);

        for (const def of defs) {
            const pg    = pgIri(entIri, def.handle);
            const quads = allQuads.get(pg.value) ?? [];
            if (quads.length === 0) { continue; }

            const iriToName = invertPropertyMap(def.properties as Record<string, IRI>);
            const raw: Record<string, unknown[]> = {};
            for (const q of quads) {
                const predStr = (q.predicate as IRI).value;
                if (predStr === TERN_HANDLE.value) { continue; }
                const propName = iriToName.get(predStr);
                if (!propName) { continue; }
                if (!raw[propName]) { raw[propName] = []; }
                raw[propName]!.push(fromLiteral(q.object));
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
        const results: Parameters<TripleStore['insert']>[0][] = [];
        for (const [propName, propIri] of Object.entries(def.properties)) {
            const value = data[propName];
            if (value === undefined || value === null) { continue; }
            if (Array.isArray(value)) {
                for (const v of value) {
                    results.push({ subject: pg, predicate: propIri as IRI, object: toLiteral(v), graph: DEFAULT_GRAPH });
                }
            } else {
                results.push({ subject: pg, predicate: propIri as IRI, object: toLiteral(value), graph: DEFAULT_GRAPH });
            }
        }
        return results;
    }

    private _applyDefaults<T extends Record<string, unknown>>(def: PropGroupDef, data: T): T {
        if (!def.defaults) { return data; }
        const result = { ...data } as Record<string, unknown>;
        for (const [key, defaultVal] of Object.entries(def.defaults)) {
            if (result[key] === undefined) {
                result[key] = typeof defaultVal === 'function'
                    ? (defaultVal as () => unknown)()
                    : defaultVal;
            }
        }
        return result as T;
    }

    private _requireGroup(schema: EntitySchema<any>, h: EntityHandle): PropGroupDef {
        const g = schema.group(h);
        if (!g) { throw new Error(`PropGroup not registered on schema: ${h.id}`); }
        return g;
    }

    private _validate(def: PropGroupDef, data: Record<string, unknown>): void {
        if (!def.shape) { return; }
        const result = validate(data, def.shape, propertyMapFor(def.properties as Record<string, IRI>));
        if (!result.valid) { throw new EntityValidationError(result.violations); }
    }

    private async _lookupNodeId(iri: IRI): Promise<number | null> {
        const knex    = this._store.knex;
        const nameRow = await knex(T.names).where(C.iri, iri.value).first<NameRow | undefined>();
        if (!nameRow) { return null; }
        const nodeRow = await knex(T.nodes)
            .where({ [C.kind]: 'iri', [C.nameId]: nameRow.id })
            .first<{ id: number } | undefined>();
        return nodeRow?.id ?? null;
    }

    private _nodeToValue(row: NodeRow | undefined): unknown {
        if (!row || row.kind !== 'literal') { return undefined; }
        const dt = row.datatype ?? 'http://www.w3.org/2001/XMLSchema#string';
        return fromLiteral({ termType: 'Literal', value: row.value ?? '', datatype: { value: dt } });
    }
}
