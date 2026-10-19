import type { IRI } from "@terncosoftware/core";

export interface CollectionViewOpts {
    sortProp?: IRI;
    sortDir?: "asc" | "desc";
}

export interface CollectionViewItemRecord {
    iri: string;
    ref: string;
    pos: number;
}

export interface CollectionViewRecord {
    iri: string;
    sourcePg: string;
    prop: string;
    sortProp?: string;
    sortDir?: "asc" | "desc";
    items: CollectionViewItemRecord[];
}
