import {
    defaultListQuery,
    type ListFilter,
    type ListQuery,
    type ListRow,
    type ListSchema,
    type ListSort,
    listKeyOf,
    normalizeListQuery,
} from "@jasonscharf/core/list";
import type React from "react";
import { useEffect, useId, useMemo, useState } from "react";
import { useListTopic, useTileCommands } from "./hooks.js";
import type { TileProps } from "./types.js";

export interface ListColumn<T extends ListRow> {
    readonly field: string;
    readonly label: string;
    readonly sortable?: boolean;
    /** Numbers and dates usually read best aligned to the end. */
    readonly align?: "start" | "end";
    readonly render?: (row: T) => React.ReactNode;
}

/** One entry of the filter menu: a label and the filters it applies. */
export interface ListFilterChoice {
    readonly id: string;
    readonly label: string;
    readonly filters: readonly ListFilter[];
}

export interface ListTileProps<T extends ListRow> extends TileProps {
    readonly topic: string;
    readonly schema: ListSchema;
    readonly columns: readonly ListColumn<T>[];
    /** What the rows are, singular and plural: { one: "user", other: "users" }. */
    readonly noun: { readonly one: string; readonly other: string };
    readonly filterChoices?: readonly ListFilterChoice[];
    readonly pageSize?: number;
}

/** What a list tile keeps in its settings between visits. */
export interface ListTileSettings {
    readonly sort?: readonly ListSort[];
    readonly search?: string;
    readonly filter?: string;
    readonly offset?: number;
}

const SEARCH_DELAY_MS = 300;

const NO_CHOICES: readonly ListFilterChoice[] = [];

function readSettings(raw: unknown): ListTileSettings {
    return typeof raw === "object" && raw !== null ? (raw as ListTileSettings) : {};
}

function buildQuery(
    settings: ListTileSettings,
    schema: ListSchema,
    choices: readonly ListFilterChoice[],
    pageSize: number | undefined,
): ListQuery {
    const fallback = defaultListQuery(schema);
    const choice = choices.find((entry) => entry.id === settings.filter);
    return normalizeListQuery(
        {
            sort: settings.sort ?? fallback.sort,
            filters: choice?.filters ?? [],
            search: settings.search ?? "",
            page: { offset: settings.offset ?? 0, limit: pageSize ?? fallback.page.limit },
        },
        schema,
    );
}

function nextSort(current: readonly ListSort[], field: string): ListSort[] {
    const head = current[0];
    if (head?.field === field) {
        return [{ field, direction: head.direction === "asc" ? "desc" : "asc" }];
    }
    return [{ field, direction: "asc" }];
}

function ariaSort(sort: readonly ListSort[], field: string): "ascending" | "descending" | "none" {
    const head = sort[0];
    if (head?.field !== field) {
        return "none";
    }
    return head.direction === "asc" ? "ascending" : "descending";
}

const COUNT = new Intl.NumberFormat();

/**
 * The reference tile: a live table over a list topic.
 *
 * Search, the filter menu, column sort and paging all become a query that the
 * topic answers; the tile never sorts or filters rows itself. Each change is
 * sent as a configure command, so it is saved for this viewer on this
 * dashboard and anything else on the dispatch can drive the tile the same way.
 */
export function ListTile<T extends ListRow>(props: ListTileProps<T>): React.ReactElement {
    const { tile, topic, schema, columns, noun, filterChoices = NO_CHOICES, pageSize } = props;
    const commands = useTileCommands(tile);
    const settings = useMemo(() => readSettings(tile.settings.list), [tile.settings.list]);
    const query = useMemo(
        () => buildQuery(settings, schema, filterChoices, pageSize),
        [settings, schema, filterChoices, pageSize],
    );
    const live = useListTopic<T>(tile, topic, schema, query);
    const [failed, setFailed] = useState<string | null>(null);
    const ids = useId();

    const save = async (patch: ListTileSettings): Promise<void> => {
        try {
            setFailed(null);
            await commands.configure({ list: { ...settings, ...patch } });
        } catch (err) {
            setFailed(err instanceof Error ? err.message : String(err));
        }
    };

    const [draft, setDraft] = useState(query.search);
    useEffect(() => {
        setDraft(query.search);
    }, [query.search]);
    const search = draft.trim();
    // biome-ignore lint/correctness/useExhaustiveDependencies: save is rebuilt every render; the search text is what should re-arm the timer.
    useEffect(() => {
        if (search === query.search) {
            return;
        }
        const timer = setTimeout(() => {
            save({ search, offset: 0 });
        }, SEARCH_DELAY_MS);
        return () => clearTimeout(timer);
    }, [search, query.search]);

    const page = live.window;
    const total = page?.total ?? 0;
    const filtered = query.search !== "" || query.filters.length > 0;
    const first = page && page.rows.length > 0 ? page.offset + 1 : 0;
    const last = page ? page.offset + page.rows.length : 0;
    const changed = new Set(live.changed);
    const word = total === 1 ? noun.one : noun.other;

    return (
        <div className="dash-list" data-testid={`dashboard-list-${tile.tileId}`}>
            <p className="dash-list__total" aria-live="polite" aria-atomic="true">
                <span
                    className="dash-list__count"
                    data-testid={`dashboard-list-total-${tile.tileId}`}
                >
                    {page ? COUNT.format(total) : "-"}
                </span>{" "}
                <span className="dash-list__noun">{filtered ? `${word} match` : word}</span>
            </p>

            <div className="dash-list__controls">
                <label className="dash-list__field" htmlFor={`${ids}-search`}>
                    <span className="dash-list__label">Search</span>
                    <input
                        id={`${ids}-search`}
                        className="dash-list__search"
                        type="search"
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        data-testid={`dashboard-list-search-${tile.tileId}`}
                    />
                </label>
                {filterChoices.length > 0 && (
                    <label className="dash-list__field" htmlFor={`${ids}-filter`}>
                        <span className="dash-list__label">Show</span>
                        <select
                            id={`${ids}-filter`}
                            className="dash-list__filter"
                            value={settings.filter ?? ""}
                            onChange={(event) =>
                                save({ filter: event.target.value || undefined, offset: 0 })
                            }
                            data-testid={`dashboard-list-filter-${tile.tileId}`}
                        >
                            <option value="">All {noun.other}</option>
                            {filterChoices.map((choice) => (
                                <option key={choice.id} value={choice.id}>
                                    {choice.label}
                                </option>
                            ))}
                        </select>
                    </label>
                )}
            </div>

            {(failed ?? live.error) && (
                <p className="dash-list__error" role="alert">
                    {failed ?? live.error}
                </p>
            )}

            <div className="dash-list__scroll">
                <table className="dash-list__table" aria-busy={live.status === "loading"}>
                    <caption className="dash-visually-hidden">
                        {tile.title}, {first}-{last} of {total}
                    </caption>
                    <thead>
                        <tr>
                            {columns.map((column) => (
                                <th
                                    key={column.field}
                                    scope="col"
                                    aria-sort={
                                        column.sortable
                                            ? ariaSort(query.sort, column.field)
                                            : undefined
                                    }
                                    data-align={column.align ?? "start"}
                                >
                                    {column.sortable ? (
                                        <button
                                            type="button"
                                            className="dash-list__sort"
                                            onClick={() =>
                                                save({
                                                    sort: nextSort(query.sort, column.field),
                                                    offset: 0,
                                                })
                                            }
                                            data-testid={`dashboard-list-sort-${tile.tileId}-${column.field}`}
                                        >
                                            {column.label}
                                            <span
                                                className="dash-list__sort-mark"
                                                aria-hidden="true"
                                            />
                                        </button>
                                    ) : (
                                        column.label
                                    )}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {page?.rows.map((row) => {
                            const key = listKeyOf(row, schema);
                            return (
                                <tr
                                    key={key}
                                    data-key={key}
                                    data-fresh={changed.has(key) ? "true" : undefined}
                                    data-testid={`dashboard-list-row-${tile.tileId}`}
                                >
                                    {columns.map((column) => (
                                        <td key={column.field} data-align={column.align ?? "start"}>
                                            {column.render
                                                ? column.render(row)
                                                : String(row[column.field] ?? "")}
                                        </td>
                                    ))}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                {page && page.rows.length === 0 && (
                    <p className="dash-list__empty">
                        {filtered ? `No ${noun.other} match.` : `No ${noun.other} yet.`}
                    </p>
                )}
                {!page && live.status === "loading" && (
                    <p className="dash-list__empty">Loading {noun.other}</p>
                )}
            </div>

            <nav className="dash-list__pager" aria-label={`${tile.title} pages`}>
                <span
                    className="dash-list__range"
                    data-testid={`dashboard-list-range-${tile.tileId}`}
                >
                    {first}-{last} of {COUNT.format(total)}
                </span>
                <button
                    type="button"
                    className="dash-list__page"
                    disabled={!page || page.offset === 0}
                    onClick={() =>
                        save({ offset: Math.max(0, query.page.offset - query.page.limit) })
                    }
                    data-testid={`dashboard-list-prev-${tile.tileId}`}
                >
                    Previous
                </button>
                <button
                    type="button"
                    className="dash-list__page"
                    disabled={!page || last >= total}
                    onClick={() => save({ offset: query.page.offset + query.page.limit })}
                    data-testid={`dashboard-list-next-${tile.tileId}`}
                >
                    Next
                </button>
            </nav>
        </div>
    );
}
