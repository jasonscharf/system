import type { IRI } from '@system/core';
import { DEFAULT_GRAPH } from '@system/core';
import type { TripleStore } from '@system/data';
import { T, C } from '@system/data';
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

// ── Internal row types mirroring @system/data/schema.ts ─────────────────────

interface NameRow  { id: number; }
interface NodeRow  { id: number; kind: string; name_id: number | null; value: string | null; datatype: string | null; lang: string | null; }
interface EdgeRow  { id: number; subject: number; predicate: number; object: number; }

/**
 * Entity-level CRUD on top of TripleStore.
 *
 * All entity properties are stored in PropGroup nodes hanging off the entity IRI:
 *   (entity, rdf:type,       schema.typeIRI)
 *   (entity, tern:propGroup, pgNode)
 *   (pgNode, tern:handle,    "handleId@version")
 *   (pgNode, prop:iri,       value)          ← scalar: one quad
 *   (pgNode, prop:iri,       value)          ← collection: multiple quads, ordered by edge.id
 */
export class EntityStore {
    private _cvsInstance: CollectionViewStore | null = null;

    constructor(private readonly _store: TripleStore) {}

    /** Lazy-initialised CollectionViewStore — avoids import cycle at module load. */
    private _cvs(): CollectionViewStore {
        if (!this._cvsInstance) { this._cvsInstance = new CollectionViewStore(this._store); }
        return this._cvsInstance;
    }

    // ── Create ────────────────────────────────────────────────────────────────

    async create<CoreProps extends Record<string, unknown>>(
        schema: EntitySchema<CoreProps>,
        data:   Partial<CoreProps>,
    ): Promise<EntityRecord> {
        const coreGroup = schema.allGroups()[0]!;
        const withDefs  = this._applyDefaults(coreGroup, data);
        this._validate(coreGroup, withDefs);

        const id  = newId();
        const ent = entityIri(schema.ns, localName(schema.typeIRI.value), id);
        const pg  = pgIri(ent.value, coreGroup.handle);

        await this._store.insertMany([
            { subject: ent, predicate: RDF_TYPE,       object: schema.typeIRI,                         graph: DEFAULT_GRAPH },
            { subject: ent, predicate: TERN_PROP_GROUP, object: pg,                                     graph: DEFAULT_GRAPH },
            { subject: pg,  predicate: TERN_HANDLE,     object: toLiteral(coreGroup.handle.toString()), graph: DEFAULT_GRAPH },
            ...this._propQuads(pg, coreGroup, withDefs),
        ]);

        return { id, iri: ent.value, groups: { [coreGroup.handle.id]: withDefs } };
    }

    // ── PropGroup management ─────────────────────────────────────────────────

    async addGroup<Props extends Record<string, unknown>>(
        schema: EntitySchema<any>,
        id:     string,
        h:      EntityHandle,
        data:   Partial<Props>,
    ): Promise<void> {
        const groupDef  = this._requireGroup(schema, h);
        const withDefs  = this._applyDefaults(groupDef, data);
        this._validate(groupDef, withDefs);

        const ent = entityIri(schema.ns, localName(schema.typeIRI.value), id);
        const pg  = pgIri(ent.value, h);

        await this._store.insertMany([
            { subject: ent, predicate: TERN_PROP_GROUP, object: pg,                             graph: DEFAULT_GRAPH },
            { subject: pg,  predicate: TERN_HANDLE,     object: toLiteral(h.toString()),         graph: DEFAULT_GRAPH },
            ...this._propQuads(pg, groupDef, withDefs),
        ]);
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
        schema: EntitySchema<any>,
        id:     string,
        h:      EntityHandle,
        patch:  Partial<Props>,
    ): Promise<void> {
        const groupDef = this._requireGroup(schema, h);
        this._validate(groupDef, patch);

        const ent = entityIri(schema.ns, localName(schema.typeIRI.value), id);
        const pg  = pgIri(ent.value, h);

        for (const [propName, value] of Object.entries(patch)) {
            const propIri = (groupDef.properties as Record<string, IRI>)[propName];
            if (!propIri) { continue; }
            await this._store.delete({ subject: pg, predicate: propIri });
            if (value !== undefined) {
                await this._store.insert({ subject: pg, predicate: propIri, object: toLiteral(value), graph: DEFAULT_GRAPH });
            }
        }
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    async delete(schema: EntitySchema<any>, id: string): Promise<void> {
        const ent     = entityIri(schema.ns, localName(schema.typeIRI.value), id);
        const pgLinks = await this._store.find({ subject: ent, predicate: TERN_PROP_GROUP });

        for (const q of pgLinks) {
            await this._store.delete({ subject: q.object as IRI });
        }
        await this._store.delete({ subject: ent });
    }

    // ── Collection API ────────────────────────────────────────────────────────

    /**
     * Returns all values for a collection property in insertion order.
     * Scalar properties (one value) are also returned as a single-element array.
     */
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

        // Direct ordered query via Knex (tern_edges.id = insertion order)
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

    /** Appends one or more values to a collection property. Registered CollectionViews are updated automatically. */
    async collectionPush(
        schema:   EntitySchema<any>,
        id:       string,
        h:        EntityHandle,
        prop:     string,
        ...values: unknown[]
    ): Promise<void> {
        const groupDef = this._requireGroup(schema, h);
        const propIri  = (groupDef.properties as Record<string, IRI>)[prop];
        if (!propIri) { throw new Error(`Property '${prop}' not found in PropGroup '${h.id}'`); }

        const ent = entityIri(schema.ns, localName(schema.typeIRI.value), id);
        const pg  = pgIri(ent.value, h);

        for (const v of values) {
            await this._store.insert({ subject: pg, predicate: propIri, object: toLiteral(v), graph: DEFAULT_GRAPH });
            // Propagate to any registered CollectionViews
            const views = await this._cvs().findViewsForSource(pg.value, propIri.value);
            for (const vIri of views) { await this._cvs().addItem(vIri, String(v)); }
        }
    }

    /**
     * Removes the first occurrence of a specific value from a collection.
     * Returns true if a value was removed. Registered CollectionViews are updated automatically.
     */
    async collectionRemove(
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

        const deleted = await this._store.delete({ subject: pg, predicate: propIri, object: toLiteral(value) });
        if (deleted > 0) {
            const views = await this._cvs().findViewsForSource(pg.value, propIri.value);
            for (const vIri of views) { await this._cvs().removeItem(vIri, String(value)); }
        }
        return deleted > 0;
    }

    // ── CollectionView convenience ────────────────────────────────────────────

    /**
     * Creates a CollectionView over a collection property, pre-populated with
     * the current items, and registers it so future `collectionPush` /
     * `collectionRemove` calls on that property auto-update the view.
     *
     * @returns The IRI string of the new CollectionView node.
     */
    async createCollectionView(
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

        return this._cvs().create(pg.value, propIri.value, currentRefs, opts);
    }

    /** Exposes the CollectionViewStore for direct view operations. */
    get views(): CollectionViewStore { return this._cvs(); }

    /**
     * Removes and returns the last-inserted value of a collection property.
     * Returns undefined if the collection is empty.
     */
    async collectionPop(
        schema: EntitySchema<any>,
        id:     string,
        h:      EntityHandle,
        prop:   string,
    ): Promise<unknown> {
        const items = await this.collectionGet(schema, id, h, prop);
        if (items.length === 0) { return undefined; }
        const last = items[items.length - 1];
        await this.collectionRemove(schema, id, h, prop, last);
        return last;
    }

    /**
     * Replaces the entire collection with the given ordered array.
     * Deletes all existing quads for the property, then inserts in the supplied order.
     * Use this for sorting: `collectionSet(schema, id, h, 'tags', sorted)`.
     */
    async collectionSet(
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

        await this._store.delete({ subject: pg, predicate: propIri });
        for (const v of values) {
            await this._store.insert({ subject: pg, predicate: propIri, object: toLiteral(v), graph: DEFAULT_GRAPH });
        }
    }

    /**
     * Inserts a value at a specific position (0-based index).
     * Implemented by fetching the current collection, splicing in the value, and
     * calling collectionSet to preserve insertion-order semantics.
     */
    async collectionInsertAt(
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
        await this.collectionSet(schema, id, h, prop, current);
    }

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

            // Collect all values per property (supporting multi-valued / collections)
            const raw: Record<string, unknown[]> = {};
            for (const q of quads) {
                const predStr = (q.predicate as IRI).value;
                if (predStr === TERN_HANDLE.value) { continue; }
                const propName = iriToName.get(predStr);
                if (!propName) { continue; }
                if (!raw[propName]) { raw[propName] = []; }
                raw[propName]!.push(fromLiteral(q.object));
            }

            // Collapse singletons to scalar; leave multi-valued as arrays
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

    private _applyDefaults<T extends Record<string, unknown>>(
        def:  PropGroupDef,
        data: T,
    ): T {
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

    /** Look up the tern_nodes.id for an IRI without creating it. Returns null if not found. */
    private async _lookupNodeId(iri: IRI): Promise<number | null> {
        const knex    = this._store.knex;
        const nameRow = await knex(T.names).where(C.iri, iri.value).first<NameRow | undefined>();
        if (!nameRow) { return null; }
        const nodeRow = await knex(T.nodes)
            .where({ [C.kind]: 'iri', [C.nameId]: nameRow.id })
            .first<{ id: number } | undefined>();
        return nodeRow?.id ?? null;
    }

    /** Convert a raw tern_nodes row to a JS value. */
    private _nodeToValue(row: NodeRow | undefined): unknown {
        if (!row) { return undefined; }
        if (row.kind === 'literal') {
            const dt = row.datatype ?? 'http://www.w3.org/2001/XMLSchema#string';
            return fromLiteral({ termType: 'Literal', value: row.value ?? '', datatype: { value: dt } });
        }
        return undefined;
    }
}
