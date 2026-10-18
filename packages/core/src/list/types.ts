/**
 * The wire shape of a list read: which rows, in what order, which page.
 *
 * One shape serves every transport. An HTTP list endpoint takes a ListQuery and
 * answers a ListWindow; a live topic takes the same ListQuery on subscribe and
 * answers ListFrames, so a table pages, sorts and filters the same way whether
 * it polls or listens.
 */

/** A cell value a list can filter, sort and search on. Dates travel as ISO-8601 UTC strings. */
export type ListValue = string | number | boolean | null;

/** One row of a list. Rows are flat so every field can be compared without knowing its type. */
export type ListRow = Readonly<Record<string, ListValue>>;

export type SortDirection = "asc" | "desc";

export interface ListSort {
    readonly field: string;
    readonly direction: SortDirection;
}

/**
 * `contains` is a case-insensitive substring match. `in` takes an array value
 * and matches any member of it. The rest compare like sort does.
 */
export type ListFilterOp = "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "contains" | "in";

export interface ListFilter {
    readonly field: string;
    readonly op: ListFilterOp;
    readonly value: ListValue | readonly ListValue[];
}

/** A page of the sorted, filtered list, by position. */
export interface ListPage {
    readonly offset: number;
    readonly limit: number;
}

export interface ListQuery {
    /** Applied in order; the row key breaks every tie so the order is total. */
    readonly sort: readonly ListSort[];
    /** Every filter must match. */
    readonly filters: readonly ListFilter[];
    /** Whitespace-separated terms; each must appear in one of the schema's search fields. */
    readonly search: string;
    readonly page: ListPage;
}

/**
 * What a list exposes to a query. A field the schema does not name cannot be
 * sorted, filtered or searched on, so a client cannot probe a column the
 * server never meant to show.
 */
export interface ListSchema {
    /** The field holding each row's unique key. */
    readonly key: string;
    /** Fields a query may sort and filter on. */
    readonly fields: readonly string[];
    /** Fields the free-text search looks in. */
    readonly searchFields: readonly string[];
    /** Order used when a query names none. */
    readonly defaultSort?: readonly ListSort[];
    /** Largest page a query may ask for. */
    readonly maxLimit?: number;
}

/** One page of a list, and how many rows the whole filtered list holds. */
export interface ListWindow<T extends ListRow = ListRow> {
    readonly rows: readonly T[];
    readonly total: number;
    readonly offset: number;
    readonly limit: number;
}

/**
 * One row changing. A new row has no `before`, a removed one has no `after`.
 * Both sides travel so a client holding only its page can tell whether the
 * row left or entered its filter.
 */
export interface ListChange<T extends ListRow = ListRow> {
    readonly key: string;
    readonly before: T | null;
    readonly after: T | null;
}

/**
 * What a live list topic sends one subscriber.
 *
 * `window` replaces the subscriber's page outright. `changes` is applied with
 * placeListChange, and only onto a page at version `from`: a subscriber at any
 * other version drops it, or re-subscribes when it is not already at `to`.
 */
export type ListFrame<T extends ListRow = ListRow> =
    | { readonly type: "window"; readonly version: string; readonly window: ListWindow<T> }
    | {
          readonly type: "changes";
          readonly from: string;
          readonly to: string;
          readonly changes: readonly ListChange<T>[];
      };

/**
 * Where one change lands on a page.
 *
 * `dropped`: the page and its total are untouched. `placed`: the new page,
 * which may differ only in its total. `stale`: the page cannot be worked out
 * from the page alone, so it has to be read again.
 */
export type ListPlacement<T extends ListRow = ListRow> =
    | { readonly kind: "dropped" }
    | { readonly kind: "placed"; readonly window: ListWindow<T> }
    | { readonly kind: "stale" };

/** A subscriber's page and the version of the list it reflects. */
export interface ListState<T extends ListRow = ListRow> {
    readonly version: string;
    readonly window: ListWindow<T>;
}
