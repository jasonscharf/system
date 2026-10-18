import {
    DEFAULT_LIST_LIMIT,
    MAX_LIST_FILTERS,
    MAX_LIST_LIMIT,
    MAX_LIST_SEARCH_LENGTH,
} from "./constants.js";
import type {
    ListFilter,
    ListFilterOp,
    ListQuery,
    ListRow,
    ListSchema,
    ListSort,
    ListValue,
    ListWindow,
} from "./types.js";

const FILTER_OPS: readonly ListFilterOp[] = [
    "eq",
    "neq",
    "lt",
    "lte",
    "gt",
    "gte",
    "contains",
    "in",
];

function isListValue(value: unknown): value is ListValue {
    return (
        value === null ||
        typeof value === "string" ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value))
    );
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, Math.floor(value)));
}

/** The key of a row, as the string every change and comparison uses. */
export function listKeyOf(row: ListRow, schema: ListSchema): string {
    return String(row[schema.key] ?? "");
}

/** The query a list starts from: the schema's default order, no filters, the first page. */
export function defaultListQuery(schema: ListSchema): ListQuery {
    return {
        sort: schema.defaultSort ?? [],
        filters: [],
        search: "",
        page: { offset: 0, limit: Math.min(DEFAULT_LIST_LIMIT, schema.maxLimit ?? MAX_LIST_LIMIT) },
    };
}

/**
 * Turn whatever arrived on the wire into a query the schema allows.
 *
 * Never throws. A field the schema does not name, an unknown operator or a
 * malformed value is dropped rather than refused, so a bad part can only ever
 * widen a list back toward its default and never reach a column it should not.
 */
export function normalizeListQuery(input: unknown, schema: ListSchema): ListQuery {
    const raw = asRecord(input);
    const fields = new Set(schema.fields);
    const fallback = defaultListQuery(schema);

    const sort: ListSort[] = [];
    for (const entry of Array.isArray(raw.sort) ? raw.sort : []) {
        const { field, direction } = asRecord(entry);
        if (typeof field === "string" && fields.has(field)) {
            sort.push({ field, direction: direction === "desc" ? "desc" : "asc" });
        }
    }

    const filters: ListFilter[] = [];
    for (const entry of Array.isArray(raw.filters) ? raw.filters : []) {
        const { field, op, value } = asRecord(entry);
        if (typeof field !== "string" || !fields.has(field)) {
            continue;
        }
        if (!FILTER_OPS.includes(op as ListFilterOp)) {
            continue;
        }
        if (op === "in") {
            if (Array.isArray(value) && value.every(isListValue)) {
                filters.push({ field, op, value: [...value] });
            }
        } else if (isListValue(value)) {
            filters.push({ field, op: op as ListFilterOp, value });
        }
        if (filters.length >= MAX_LIST_FILTERS) {
            break;
        }
    }

    const search =
        typeof raw.search === "string" ? raw.search.trim().slice(0, MAX_LIST_SEARCH_LENGTH) : "";

    const page = asRecord(raw.page);
    const maxLimit = schema.maxLimit ?? MAX_LIST_LIMIT;
    return {
        sort: sort.length > 0 ? sort : fallback.sort,
        filters,
        search,
        page: {
            offset: clampInt(page.offset, 0, Number.MAX_SAFE_INTEGER, 0),
            limit: clampInt(page.limit, 1, maxLimit, fallback.page.limit),
        },
    };
}

/**
 * Order two cell values. Nulls sort last ascending. Values of different types
 * order by type name so the order stays total even on mixed columns. Strings
 * compare case-insensitively, then exactly, by code point rather than locale
 * so a server and a browser always agree.
 */
export function compareListValues(a: ListValue, b: ListValue): number {
    if (a === b) {
        return 0;
    }
    if (a === null) {
        return 1;
    }
    if (b === null) {
        return -1;
    }
    if (typeof a !== typeof b) {
        return typeof a < typeof b ? -1 : 1;
    }
    if (typeof a === "string" && typeof b === "string") {
        const la = a.toLowerCase();
        const lb = b.toLowerCase();
        if (la !== lb) {
            return la < lb ? -1 : 1;
        }
    }
    return a < b ? -1 : 1;
}

/** Order two rows by the query's sort, then by key, so no two rows ever tie. */
export function compareListRows(
    a: ListRow,
    b: ListRow,
    query: ListQuery,
    schema: ListSchema,
): number {
    for (const { field, direction } of query.sort) {
        const order = compareListValues(a[field] ?? null, b[field] ?? null);
        if (order !== 0) {
            return direction === "desc" ? -order : order;
        }
    }
    return compareListValues(listKeyOf(a, schema), listKeyOf(b, schema));
}

function matchesFilter(row: ListRow, filter: ListFilter): boolean {
    const cell = row[filter.field] ?? null;
    const { value } = filter;
    switch (filter.op) {
        case "in":
            return Array.isArray(value) && value.includes(cell);
        case "contains":
            return (
                cell !== null &&
                String(cell)
                    .toLowerCase()
                    .includes(String(value ?? "").toLowerCase())
            );
        case "eq":
            return cell === value;
        case "neq":
            return cell !== value;
        default: {
            if (cell === null || value === null || Array.isArray(value)) {
                return false;
            }
            const order = compareListValues(cell, value as ListValue);
            switch (filter.op) {
                case "lt":
                    return order < 0;
                case "lte":
                    return order <= 0;
                case "gt":
                    return order > 0;
                default:
                    return order >= 0;
            }
        }
    }
}

/** True when the row passes every filter and the search. */
export function matchesListQuery(row: ListRow, query: ListQuery, schema: ListSchema): boolean {
    for (const filter of query.filters) {
        if (!matchesFilter(row, filter)) {
            return false;
        }
    }
    const terms = query.search.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) {
        return true;
    }
    const haystack = schema.searchFields
        .map((field) => row[field])
        .filter((cell) => cell !== null && cell !== undefined)
        .map((cell) => String(cell).toLowerCase());
    return terms.every((term) => haystack.some((cell) => cell.includes(term)));
}

/** Every row the query's filters and search admit, in the query's order. */
export function selectListRows<T extends ListRow>(
    rows: readonly T[],
    query: ListQuery,
    schema: ListSchema,
): T[] {
    return rows
        .filter((row) => matchesListQuery(row, query, schema))
        .sort((a, b) => compareListRows(a, b, query, schema));
}

/** Filter, sort and page rows held in memory. */
export function applyListQuery<T extends ListRow>(
    rows: readonly T[],
    query: ListQuery,
    schema: ListSchema,
): ListWindow<T> {
    const selected = selectListRows(rows, query, schema);
    const { offset, limit } = query.page;
    return {
        rows: selected.slice(offset, offset + limit),
        total: selected.length,
        offset,
        limit,
    };
}
