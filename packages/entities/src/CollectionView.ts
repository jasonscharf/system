import { IRI, DEFAULT_GRAPH } from '@jasonscharf/core';
import type { TripleStore, ServerContext } from '@jasonscharf/data';
import {
    RDF_TYPE, TERN_PROP_GROUP,
    TERN_VIEW_NS,
    TERN_COLLECTION_VIEW, TERN_COLLECTION_VIEW_ITEM,
    TERN_CV_SOURCE, TERN_CV_PROP, TERN_CV_SORT_PROP, TERN_CV_SORT_DIR, TERN_CV_ITEM,
    TERN_CVI_VIEW, TERN_CVI_REF, TERN_CVI_POS,
} from './constants.js';
import { toLiteral, fromLiteral, newId } from './util.js';


export interface CollectionViewOpts {
    /**
     * IRI of a property to sort by on each referenced entity.
     * When set, `getView()` resolves this property's value on each ref and
     * sorts accordingly (asc/desc).  Works with the two-hop PropGroup model:
     * if the property is not found directly on the ref IRI, the entity's
     * PropGroup nodes are searched automatically.
     */
    sortProp?: IRI;
    sortDir?:  'asc' | 'desc';
}

export interface CollectionViewItemRecord {
    /** IRI of the CollectionViewItem node. */
    iri: string;
    /** String representation of the referenced item (entity IRI or plain value). */
    ref: string;
    /** Zero-based position within the view. */
    pos: number;
}

export interface CollectionViewRecord {
    iri:       string;
    /** PropGroup node IRI that owns the source collection. */
    sourcePg:  string;
    /** Property IRI string on the source PropGroup. */
    prop:      string;
    sortProp?: string;
    sortDir?:  'asc' | 'desc';
    items:     CollectionViewItemRecord[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function viewIri(id: string):     IRI { return new IRI(`${TERN_VIEW_NS}${id}`); }
function viewItemIri(id: string): IRI { return new IRI(`${TERN_VIEW_NS}item/${id}`); }

function str(term: unknown): string { return String(fromLiteral(term) ?? ''); }

/**
 * Graph-native view over a collection property.
 *
 * A CollectionView points at a PropGroup node + property, maintains an ordered
 * list of CollectionViewItem nodes (one per source item), and supports
 * optional sorting by a property on the referenced entities.
 *
 * EntityStore integrates CollectionViewStore automatically: when
 * `collectionPush` or `collectionRemove` is called and registered views exist
 * for that PropGroup + property, they are updated in the same operation.
 */
export class CollectionViewStore {
    constructor(private readonly _store: TripleStore) {}

    // ── Create ────────────────────────────────────────────────────────────────

    /**
     * Creates a CollectionView and populates it with a CollectionViewItem for
     * each value in `currentRefs` (the source collection's current state).
     *
     * @returns The IRI string of the new CollectionView node.
     */
    async create(
        ctx:           ServerContext,
        sourcePgIri:   string,
        sourcePropIri: string,
        currentRefs:   string[],
        opts:          CollectionViewOpts = {},
    ): Promise<string> {
        const id  = newId();
        const vIri = viewIri(id);

        await this._store.insertMany(ctx, [
            { subject: vIri, predicate: RDF_TYPE,       object: TERN_COLLECTION_VIEW,           graph: DEFAULT_GRAPH },
            { subject: vIri, predicate: TERN_CV_SOURCE, object: toLiteral(sourcePgIri),         graph: DEFAULT_GRAPH },
            { subject: vIri, predicate: TERN_CV_PROP,   object: toLiteral(sourcePropIri),       graph: DEFAULT_GRAPH },
            ...(opts.sortProp ? [{ subject: vIri, predicate: TERN_CV_SORT_PROP, object: toLiteral(opts.sortProp.value), graph: DEFAULT_GRAPH }] : []),
            ...(opts.sortDir  ? [{ subject: vIri, predicate: TERN_CV_SORT_DIR,  object: toLiteral(opts.sortDir),        graph: DEFAULT_GRAPH }] : []),
        ]);

        for (const [pos, ref] of currentRefs.entries()) {
            await this._createItem(ctx, vIri.value, ref, pos);
        }

        return vIri.value;
    }

    // ── Item management ───────────────────────────────────────────────────────

    /**
     * Appends a CollectionViewItem for a new value. Idempotent — ignored if
     * the ref is already present in the view.
     */
    async addItem(ctx: ServerContext, viewIriStr: string, ref: string): Promise<void> {
        const items = await this._getItems(ctx, viewIriStr);
        if (items.some(i => i.ref === ref)) { return; }
        await this._createItem(ctx, viewIriStr, ref, items.length);
    }

    /**
     * Removes the CollectionViewItem for the given ref.
     * Returns true if something was removed.
     */
    async removeItem(ctx: ServerContext, viewIriStr: string, ref: string): Promise<boolean> {
        const items = await this._getItems(ctx, viewIriStr);
        const item  = items.find(i => i.ref === ref);
        if (!item) { return false; }

        const itemNode = new IRI(item.iri);
        const viewNode = new IRI(viewIriStr);

        await this._store.delete(ctx, { subject: viewNode, predicate: TERN_CV_ITEM, object: itemNode });
        await this._store.delete(ctx, { subject: itemNode });
        return true;
    }

    // ── Read ──────────────────────────────────────────────────────────────────

    /**
     * Retrieves the CollectionView and its items in position order.
     *
     * If `sortProp` is configured, items are re-sorted at read time by
     * resolving that property on each referenced entity — first checking
     * direct quads on the ref IRI, then the entity's PropGroup nodes.
     */
    async getView(ctx: ServerContext, viewIriStr: string): Promise<CollectionViewRecord | null> {
        const vNode = new IRI(viewIriStr);
        const quads = await this._store.find(ctx, { subject: vNode });
        if (quads.length === 0) { return null; }

        let sourcePg = '', prop = '', sortProp: string | undefined, sortDir: 'asc' | 'desc' | undefined;
        for (const q of quads) {
            const pred = (q.predicate as IRI).value;
            const val  = str(q.object);
            if (pred === TERN_CV_SOURCE.value)    { sourcePg = val; }
            if (pred === TERN_CV_PROP.value)      { prop     = val; }
            if (pred === TERN_CV_SORT_PROP.value) { sortProp = val; }
            if (pred === TERN_CV_SORT_DIR.value)  { sortDir  = val as 'asc' | 'desc'; }
        }

        let items = await this._getItems(ctx, viewIriStr);
        items.sort((a, b) => a.pos - b.pos);

        if (sortProp) {
            items = await this._sortByProp(ctx, items, sortProp, sortDir ?? 'asc');
        }

        return { iri: viewIriStr, sourcePg, prop, sortProp, sortDir, items };
    }

    // ── Mutation ──────────────────────────────────────────────────────────────

    /**
     * Replaces the explicit position ordering of items.
     * `orderedRefs` must contain the same values as the current item set.
     */
    async reorder(ctx: ServerContext, viewIriStr: string, orderedRefs: string[]): Promise<void> {
        const items = await this._getItems(ctx, viewIriStr);
        for (const [newPos, ref] of orderedRefs.entries()) {
            const item = items.find(i => i.ref === ref);
            if (!item) { continue; }
            const itemNode = new IRI(item.iri);
            await this._store.delete(ctx, { subject: itemNode, predicate: TERN_CVI_POS });
            await this._store.insert(ctx, { subject: itemNode, predicate: TERN_CVI_POS, object: toLiteral(newPos), graph: DEFAULT_GRAPH });
        }
    }

    /**
     * Syncs the view to match a fresh snapshot of the source collection.
     * Adds items for refs not yet in the view; removes items whose refs are
     * no longer in `currentRefs`.
     */
    async sync(ctx: ServerContext, viewIriStr: string, currentRefs: string[]): Promise<void> {
        const items    = await this._getItems(ctx, viewIriStr);
        const existing = new Set(items.map(i => i.ref));
        const current  = new Set(currentRefs);

        for (const ref of currentRefs) {
            if (!existing.has(ref)) { await this.addItem(ctx, viewIriStr, ref); }
        }
        for (const item of items) {
            if (!current.has(item.ref)) { await this.removeItem(ctx, viewIriStr, item.ref); }
        }
    }

    /** Deletes the CollectionView and all its CollectionViewItem nodes. */
    async delete(ctx: ServerContext, viewIriStr: string): Promise<void> {
        const items    = await this._getItems(ctx, viewIriStr);
        const viewNode = new IRI(viewIriStr);

        for (const item of items) {
            const itemNode = new IRI(item.iri);
            await this._store.delete(ctx, { subject: viewNode, predicate: TERN_CV_ITEM, object: itemNode });
            await this._store.delete(ctx, { subject: itemNode });
        }
        await this._store.delete(ctx, { subject: viewNode });
    }

    // ── Lookup (used by EntityStore auto-update) ──────────────────────────────

    /**
     * Returns IRIs of all CollectionViews watching the given
     * (sourcePgIri, propIri) pair.  Called by EntityStore after every
     * `collectionPush` / `collectionRemove` to propagate changes.
     */
    async findViewsForSource(ctx: ServerContext, sourcePgIri: string, propIri: string): Promise<string[]> {
        // Find all views with matching source PropGroup
        const bySource = await this._store.find(ctx, {
            predicate: TERN_CV_SOURCE,
            object:    toLiteral(sourcePgIri),
        });
        if (bySource.length === 0) { return []; }

        // Filter to those that also match the specific property
        const result: string[] = [];
        for (const q of bySource) {
            const viewNode = q.subject as IRI;
            const propQ    = await this._store.find(ctx, {
                subject:   viewNode,
                predicate: TERN_CV_PROP,
                object:    toLiteral(propIri),
            });
            if (propQ.length > 0) { result.push(viewNode.value); }
        }
        return result;
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private async _createItem(ctx: ServerContext, viewIriStr: string, ref: string, pos: number): Promise<void> {
        const itemId   = newId();
        const itemNode = viewItemIri(itemId);
        const viewNode = new IRI(viewIriStr);

        await this._store.insertMany(ctx, [
            { subject: itemNode, predicate: RDF_TYPE,      object: TERN_COLLECTION_VIEW_ITEM, graph: DEFAULT_GRAPH },
            { subject: itemNode, predicate: TERN_CVI_VIEW, object: viewNode,                  graph: DEFAULT_GRAPH },
            { subject: itemNode, predicate: TERN_CVI_REF,  object: toLiteral(ref),            graph: DEFAULT_GRAPH },
            { subject: itemNode, predicate: TERN_CVI_POS,  object: toLiteral(pos),            graph: DEFAULT_GRAPH },
            { subject: viewNode, predicate: TERN_CV_ITEM,  object: itemNode,                  graph: DEFAULT_GRAPH },
        ]);
    }

    private async _getItems(ctx: ServerContext, viewIriStr: string): Promise<CollectionViewItemRecord[]> {
        const viewNode  = new IRI(viewIriStr);
        const itemLinks = await this._store.find(ctx, { subject: viewNode, predicate: TERN_CV_ITEM });
        if (itemLinks.length === 0) { return []; }

        const itemIris   = itemLinks.map(q => q.object as IRI);
        const allQuads   = await this._store.findForSubjects(ctx, itemIris);

        return itemLinks.map(link => {
            const itemIriStr = (link.object as IRI).value;
            const quads      = allQuads.get(itemIriStr) ?? [];
            let ref = '', pos = 0;
            for (const q of quads) {
                const pred = (q.predicate as IRI).value;
                if (pred === TERN_CVI_REF.value) { ref = str(q.object); }
                if (pred === TERN_CVI_POS.value) { pos = Number(fromLiteral(q.object) ?? 0); }
            }
            return { iri: itemIriStr, ref, pos };
        });
    }

    /**
     * Sorts items by resolving `sortPropIri` on each referenced entity.
     *
     * Resolution order:
     *   1. Direct quad: (ref_iri, sortProp, value)
     *   2. Via PropGroup: (ref_iri, tern:propGroup, pg) → (pg, sortProp, value)
     *      — handles the standard EntityStore two-hop architecture.
     */
    private async _sortByProp(
        ctx:      ServerContext,
        items:    CollectionViewItemRecord[],
        sortProp: string,
        sortDir:  'asc' | 'desc',
    ): Promise<CollectionViewItemRecord[]> {
        const propIri = new IRI(sortProp);

        const withValues = await Promise.all(items.map(async item => {
            let sortVal: unknown;
            try {
                const refIri = new IRI(item.ref);

                // 1. Try direct property lookup
                const direct = await this._store.find(ctx, { subject: refIri, predicate: propIri });
                if (direct.length > 0) {
                    sortVal = fromLiteral(direct[0]!.object);
                } else {
                    // 2. Try via PropGroup (EntityStore architecture)
                    const pgLinks = await this._store.find(ctx, { subject: refIri, predicate: TERN_PROP_GROUP });
                    for (const pg of pgLinks) {
                        const propQ = await this._store.find(ctx, { subject: pg.object as IRI, predicate: propIri });
                        if (propQ.length > 0) { sortVal = fromLiteral(propQ[0]!.object); break; }
                    }
                }
            } catch { /* non-IRI ref — skip property lookup */ }
            return { item, sortVal };
        }));

        withValues.sort((a, b) => {
            const av = a.sortVal ?? '';
            const bv = b.sortVal ?? '';
            const cmp = av < bv ? -1 : av > bv ? 1 : 0;
            return sortDir === 'asc' ? cmp : -cmp;
        });

        return withValues.map(x => x.item);
    }
}
