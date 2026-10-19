import type { ListQuery, ListRow, ListSchema } from "@terncosoftware/core/list";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ListTopicView, type ListViewSnapshot } from "../ListTopicView.js";
import { DashboardCommands, DashboardEvents } from "../messages.js";
import type { TileSettings, TileSize, TileState } from "../model.js";
import { useDashboardHost } from "./context.js";

export interface TileCommands {
    resize(size: TileSize): Promise<void>;
    configure(settings: TileSettings): Promise<void>;
    reset(): Promise<void>;
    refresh(): Promise<void>;
}

/** The dashboard commands, bound to one tile. */
export function useTileCommands(tile: TileState): TileCommands {
    const { runtime } = useDashboardHost();
    const { dispatch } = runtime;
    const { dashboardId, tileId } = tile;
    const resize = useCallback(
        (size: TileSize) =>
            dispatch.command(DashboardCommands.resizeTile).exec({ dashboardId, tileId, size }),
        [dispatch, dashboardId, tileId],
    );
    const configure = useCallback(
        (settings: TileSettings) =>
            dispatch
                .command(DashboardCommands.configureTile)
                .exec({ dashboardId, tileId, settings }),
        [dispatch, dashboardId, tileId],
    );
    const reset = useCallback(
        () => dispatch.command(DashboardCommands.resetTile).exec({ dashboardId, tileId }),
        [dispatch, dashboardId, tileId],
    );
    const refresh = useCallback(
        () => dispatch.command(DashboardCommands.refreshTile).exec({ dashboardId, tileId }),
        [dispatch, dashboardId, tileId],
    );
    return { resize, configure, reset, refresh };
}

/** Run `onRefresh` whenever this tile is asked to read its data again. */
export function useTileRefresh(tile: TileState, onRefresh: () => void): void {
    const { runtime } = useDashboardHost();
    const { dashboardId, tileId } = tile;
    useEffect(
        () =>
            runtime.dispatch.on(DashboardEvents.tileRefreshRequested, (address) => {
                if (address.dashboardId === dashboardId && address.tileId === tileId) {
                    onRefresh();
                }
            }),
        [runtime, dashboardId, tileId, onRefresh],
    );
}

/**
 * One live page of a list topic for one tile. The view is keyed by the tile,
 * so two tiles on the same topic each hold their own query.
 */
export function useListTopic<T extends ListRow>(
    tile: TileState,
    topic: string,
    schema: ListSchema,
    query: ListQuery,
): ListViewSnapshot<T> {
    const { lists } = useDashboardHost();
    const view = `${tile.dashboardId}/${tile.tileId}`;
    const [live] = useState(() => new ListTopicView<T>(lists, topic, view, schema, query));

    useEffect(() => {
        live.start();
        return () => live.stop();
    }, [live]);

    const queryKey = JSON.stringify(query);
    useEffect(() => {
        if (JSON.stringify(live.snapshot().query) !== queryKey) {
            live.setQuery(JSON.parse(queryKey) as ListQuery);
        }
    }, [live, queryKey]);

    useTileRefresh(
        tile,
        useCallback(() => live.refresh(), [live]),
    );

    return useSyncExternalStore(live.subscribe, live.snapshot, live.snapshot);
}
