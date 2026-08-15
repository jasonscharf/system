// auto-generated — do not edit by hand

import { IRI } from "../semantics/IRI.js";

/** A view over a collection property.  Stores sort/filter config and owns CollectionViewItems. */
export interface CollectionView {
    /** IRI string of the PropGroup node that owns the source collection. */
    cvSource?: string;
    /** IRI string of the property on the source PropGroup this view is over. */
    cvProp?: string;
    /** Optional IRI string of the property to sort by on each referenced entity. */
    cvSortProp?: string;
    /** Sort direction: 'asc' or 'desc' (default 'asc'). */
    cvSortDir?: string;
    /** Links a CollectionView to one of its CollectionViewItems. */
    cvItem?: CollectionViewItem[];
}

export const CollectionViewIRI = new IRI("urn:sys:core:core:CollectionView");

/** One entry in a CollectionView.  Points back to its parent view and to the actual item. */
export interface CollectionViewItem {
    /** String representation of the referenced collection item (IRI or plain value). */
    cviRef?: string;
    /** Zero-based position of this item within the CollectionView. */
    cviPos?: number;
    /** Back-link from a CollectionViewItem to its parent CollectionView. */
    cviView?: CollectionView[];
}

export const CollectionViewItemIRI = new IRI("urn:sys:core:core:CollectionViewItem");

export const propGroupIRI = new IRI("urn:sys:core:core:propGroup");
export const handleIRI = new IRI("urn:sys:core:core:handle");
export const cvSourceIRI = new IRI("urn:sys:core:core:cvSource");
export const cvPropIRI = new IRI("urn:sys:core:core:cvProp");
export const cvSortPropIRI = new IRI("urn:sys:core:core:cvSortProp");
export const cvSortDirIRI = new IRI("urn:sys:core:core:cvSortDir");
export const cvItemIRI = new IRI("urn:sys:core:core:cvItem");
export const cviRefIRI = new IRI("urn:sys:core:core:cviRef");
export const cviPosIRI = new IRI("urn:sys:core:core:cviPos");
export const cviViewIRI = new IRI("urn:sys:core:core:cviView");
