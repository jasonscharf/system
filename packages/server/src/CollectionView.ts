import { IRI, DEFAULT_GRAPH } from '@jasonscharf/core';
import type { TripleStore } from '@jasonscharf/data';
import type { ServerContext } from './ServerContext.js';
import {
    RDF_TYPE, TERN_PROP_GROUP,
    TERN_VIEW_NS,
    TERN_COLLECTION_VIEW, TERN_COLLECTION_VIEW_ITEM,
    TERN_CV_SOURCE, TERN_CV_PROP, TERN_CV_SORT_PROP, TERN_CV_SORT_DIR, TERN_CV_ITEM,
    TERN_CVI_VIEW, TERN_CVI_REF, TERN_CVI_POS,
} from '@jasonscharf/entities';
import { toLiteral, fromLiteral, newId } from '@jasonscharf/entities';


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

// ── CollectionViewStore ───────────────────────────────────────────────────────

export class CollectionViewStore {
    constructor(private readonly _store: TripleStore) {}

    /**
     * Creates a CollectionView over a source PropGroup + property pair.
     * Pre-populates the view with `initialRefs` (entity IRI strings or plain values).
     * Returns the view IRI string (stable identifier for subsequent operations).
     */
    async create(
        ctx:         ServerContext,
        sourcePgIri: string,
        propIri:     string,
        initialRefs: string[],
        opts:        CollectionViewOpts = {},
    ): Promise<string> {
        const id      = newId();
        const viewIRI = viewIri(id);

        const quads: Parameters<TripleStore['insert']>[1][] = [
            { subject: viewIRI, predicate: RDF_TYPE,       object: TERN_COLLECTION_VIEW,          graph: DEFAULT_GRAPH },
            { subject: viewIRI, predicate: TERN_CV_SOURCE, object: toLiteral(sourcePgIri),         graph: DEFAULT_GRAPH },
            { subject: viewIRI, predicate: TERN_CV_PROP,   object: toLiteral(propIri),             graph: DEFAULT_GRAPH },
        ];
        if (opts.sortProp) {
            quads.push({ subject: viewIRI, predicate: TERN_CV_SORT_PROP, object: toLiteral(opts.sortProp.value), graph: DEFAULT_GRAPH });
        }
        if (opts.sortDir) {
            quads.push({ subject: viewIRI, predicate: TERN_CV_SORT_DIR, object: toLiteral(opts.sortDir), graph: DEFAULT_GRAPH });
        }

        // Add initial items in order
        for (let i = 0; i < initialRefs.length; i++) {
            const itemIRI = viewItemIri(newId());
            quads.push(
                { subject: viewIRI,  predicate: TERN_CV_ITEM,  object: itemIRI,              graph: DEFAULT_GRAPH },
                { subject: itemIRI,  predicate: RDF_TYPE,      object: TERN_COLLECTION_VIEW_ITEM, graph: DEFAULT_GRAPH },
                { subject: itemIRI,  predicate: TERN_CVI_VIEW, object: viewIRI,              graph: DEFAULT_GRAPH },
                { subject: itemIRI,  predicate: TERN_CVI_REF,  object: toLiteral(initialRefs[i]!), graph: DEFAULT_GRAPH },
                { subject: itemIRI,  predicate: TERN_CVI_POS,  object: toLiteral(i),         graph: DEFAULT_GRAPH },
            );
        }

        await this._store.insertMany(ctx, quads);
        return viewIRI.value;
    }

    /** Fetches the full CollectionView including ordered items. */
    async getView(ctx: ServerContext, viewIriStr: string): Promise<CollectionViewRecord | null> {
        const viewIRI = new IRI(viewIriStr);
        const meta    = await this._store.find(ctx, { subject: viewIRI });
        if (meta.length === 0) { return null; }

        let sourcePg = '';
        let prop     = '';
        let sortProp: string | undefined;
        let sortDir:  'asc' | 'desc' | undefined;

        for (const q of meta) {
            const pred = (q.predicate as IRI).value;
            if (pred === TERN_CV_SOURCE.value) { sourcePg = String(fromLiteral(q.object)); }
            if (pred === TERN_CV_PROP.value)   { prop     = String(fromLiteral(q.object)); }
            if (pred === TERN_CV_SORT_PROP.value) { sortProp = String(fromLiteral(q.object)); }
            if (pred === TERN_CV_SORT_DIR.value)  { sortDir  = String(fromLiteral(q.object)) as 'asc' | 'desc'; }
        }

        // Collect item IRIs from TERN_CV_ITEM links
        const itemIriStrs = meta
            .filter(q => (q.predicate as IRI).value === TERN_CV_ITEM.value)
            .map(q => (q.object as IRI).value);

        if (itemIriStrs.length === 0) {
            return { iri: viewIriStr, sourcePg, prop, sortProp, sortDir, items: [] };
        }

        // Fetch all item quads in one call
        const itemNodes  = itemIriStrs.map(s => new IRI(s));
        const allItemQ   = await this._store.findForSubjects(ctx, itemNodes);

        const rawItems: { iri: string; ref: string; pos: number; sortVal?: unknown }[] = [];
        for (const itemIriStr of itemIriStrs) {
            const quads = allItemQ.get(itemIriStr) ?? [];
            let ref = '';
            let pos = 0;
            for (const q of quads) {
                const pred = (q.predicate as IRI).value;
                if (pred === TERN_CVI_REF.value) { ref = String(fromLiteral(q.object)); }
                if (pred === TERN_CVI_POS.value) { pos = Number(fromLiteral(q.object)); }
            }
            rawItems.push({ iri: itemIriStr, ref, pos });
        }

        // If sortProp is set, resolve it via the two-hop PropGroup model
        if (sortProp) {
            const sortPropIRI = new IRI(sortProp);
            for (const item of rawItems) {
                // Try direct lookup first
                const directQ = await this._store.find(ctx, { subject: new IRI(item.ref), predicate: sortPropIRI });
                if (directQ.length > 0) {
                    item.sortVal = fromLiteral(directQ[0]!.object);
                } else {
                    // Two-hop: find PropGroup nodes for the ref entity, then look up the property
                    const pgLinks = await this._store.find(ctx, { subject: new IRI(item.ref), predicate: TERN_PROP_GROUP });
                    for (const pgLink of pgLinks) {
                        const propQ = await this._store.find(ctx, { subject: pgLink.object as IRI, predicate: sortPropIRI });
                        if (propQ.length > 0) {
                            item.sortVal = fromLiteral(propQ[0]!.object);
                            break;
                        }
                    }
                }
            }
            rawItems.sort((a, b) => {
                const av = a.sortVal;
                const bv = b.sortVal;
                if (av === bv) { return 0; }
                const cmp = av == null ? -1 : bv == null ? 1 : (av < bv ? -1 : 1);
                return sortDir === 'desc' ? -cmp : cmp;
            });
        } else {
            rawItems.sort((a, b) => a.pos - b.pos);
        }

        return {
            iri: viewIriStr,
            sourcePg,
            prop,
            sortProp,
            sortDir,
            items: rawItems.map(({ iri, ref, pos }) => ({ iri, ref, pos })),
        };
    }

    /** Returns IRIs of all CollectionViews that watch a given source PropGroup + property. */
    async findViewsForSource(
        ctx:         ServerContext,
        sourcePgIri: string,
        propIri:     string,
    ): Promise<string[]> {
        const sourceQ = await this._store.find(ctx, { predicate: TERN_CV_SOURCE, object: toLiteral(sourcePgIri) });
        const propQ   = await this._store.find(ctx, { predicate: TERN_CV_PROP,   object: toLiteral(propIri) });

        const sourceViews = new Set(sourceQ.map(q => (q.subject as IRI).value));
        return propQ
            .map(q => (q.subject as IRI).value)
            .filter(v => sourceViews.has(v));
    }

    /** Appends a new item to a CollectionView at the next position. */
    async addItem(ctx: ServerContext, viewIriStr: string, ref: string): Promise<void> {
        const viewIRI  = new IRI(viewIriStr);
        const itemsQ   = await this._store.find(ctx, { subject: viewIRI, predicate: TERN_CV_ITEM });
        const nextPos  = itemsQ.length;
        const itemIRI  = viewItemIri(newId());

        await this._store.insertMany(ctx, [
            { subject: viewIRI,  predicate: TERN_CV_ITEM,  object: itemIRI,                   graph: DEFAULT_GRAPH },
            { subject: itemIRI,  predicate: RDF_TYPE,      object: TERN_COLLECTION_VIEW_ITEM,  graph: DEFAULT_GRAPH },
            { subject: itemIRI,  predicate: TERN_CVI_VIEW, object: viewIRI,                   graph: DEFAULT_GRAPH },
            { subject: itemIRI,  predicate: TERN_CVI_REF,  object: toLiteral(ref),            graph: DEFAULT_GRAPH },
            { subject: itemIRI,  predicate: TERN_CVI_POS,  object: toLiteral(nextPos),        graph: DEFAULT_GRAPH },
        ]);
    }

    /** Removes the first item with the given ref from a CollectionView and compacts positions. */
    async removeItem(ctx: ServerContext, viewIriStr: string, ref: string): Promise<void> {
        const view = await this.getView(ctx, viewIriStr);
        if (!view) { return; }

        const target = view.items.find(i => i.ref === ref);
        if (!target) { return; }

        // Delete the item node
        await this._store.delete(ctx, { subject: new IRI(target.iri) });
        // Remove the cv:item link from the view
        await this._store.delete(ctx, { subject: new IRI(viewIriStr), predicate: TERN_CV_ITEM, object: new IRI(target.iri) });

        // Compact positions of remaining items
        const remaining = view.items.filter(i => i.iri !== target.iri);
        for (let i = 0; i < remaining.length; i++) {
            const item     = remaining[i]!;
            const itemNode = new IRI(item.iri);
            await this._store.delete(ctx, { subject: itemNode, predicate: TERN_CVI_POS });
            await this._store.insert(ctx, { subject: itemNode, predicate: TERN_CVI_POS, object: toLiteral(i), graph: DEFAULT_GRAPH });
        }
    }

    /** Reorders items to match the provided ref sequence. */
    async reorder(ctx: ServerContext, viewIriStr: string, refs: string[]): Promise<void> {
        const view = await this.getView(ctx, viewIriStr);
        if (!view) { return; }

        const byRef = new Map(view.items.map(i => [i.ref, i]));
        for (let i = 0; i < refs.length; i++) {
            const item = byRef.get(refs[i]!);
            if (!item) { continue; }
            const itemNode = new IRI(item.iri);
            await this._store.delete(ctx, { subject: itemNode, predicate: TERN_CVI_POS });
            await this._store.insert(ctx, { subject: itemNode, predicate: TERN_CVI_POS, object: toLiteral(i), graph: DEFAULT_GRAPH });
        }
    }

    /** Replaces all items in the view to match `refs` exactly (used for full sync after collectionSet). */
    async sync(ctx: ServerContext, viewIriStr: string, refs: string[]): Promise<void> {
        const view = await this.getView(ctx, viewIriStr);
        if (!view) { return; }

        const viewIRI = new IRI(viewIriStr);

        // Delete all existing items
        for (const item of view.items) {
            await this._store.delete(ctx, { subject: new IRI(item.iri) });
        }
        await this._store.delete(ctx, { subject: viewIRI, predicate: TERN_CV_ITEM });

        // Re-insert in new order
        const quads: Parameters<TripleStore['insert']>[1][] = [];
        for (let i = 0; i < refs.length; i++) {
            const itemIRI = viewItemIri(newId());
            quads.push(
                { subject: viewIRI,  predicate: TERN_CV_ITEM,  object: itemIRI,                   graph: DEFAULT_GRAPH },
                { subject: itemIRI,  predicate: RDF_TYPE,      object: TERN_COLLECTION_VIEW_ITEM,  graph: DEFAULT_GRAPH },
                { subject: itemIRI,  predicate: TERN_CVI_VIEW, object: viewIRI,                   graph: DEFAULT_GRAPH },
                { subject: itemIRI,  predicate: TERN_CVI_REF,  object: toLiteral(refs[i]!),       graph: DEFAULT_GRAPH },
                { subject: itemIRI,  predicate: TERN_CVI_POS,  object: toLiteral(i),              graph: DEFAULT_GRAPH },
            );
        }
        if (quads.length > 0) { await this._store.insertMany(ctx, quads); }
    }

    /** Deletes the view and all its item nodes. */
    async delete(ctx: ServerContext, viewIriStr: string): Promise<void> {
        const view = await this.getView(ctx, viewIriStr);
        if (!view) { return; }

        for (const item of view.items) {
            await this._store.delete(ctx, { subject: new IRI(item.iri) });
        }
        await this._store.delete(ctx, { subject: new IRI(viewIriStr) });
    }
}
