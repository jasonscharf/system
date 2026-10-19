import type { TileSettings, TileSize, TileState } from "./model.js";

/** Addresses one tile on one dashboard. */
export interface TileAddress {
    readonly dashboardId: string;
    readonly tileId: string;
}

export interface ResizeTileArgs extends TileAddress {
    readonly size: TileSize;
}

export interface ConfigureTileArgs extends TileAddress {
    /** Merged over the tile's current settings. */
    readonly settings: TileSettings;
}

/** Commands a dashboard accepts. Anything holding the dispatch can send them. */
export const DashboardCommands = {
    /** Resize a tile, clamped to what its type allows. */
    resizeTile: "dashboard.tile.resize",
    /** Change a tile's settings. */
    configureTile: "dashboard.tile.configure",
    /** Drop the viewer's preferences for a tile. */
    resetTile: "dashboard.tile.reset",
    /** Ask a tile to read its data again. */
    refreshTile: "dashboard.tile.refresh",
} as const;

/** Events a dashboard raises. */
export const DashboardEvents = {
    /** A tile's size or settings changed, carrying its new state. */
    tileChanged: "dashboard.tile.changed",
    /** A tile was asked to read its data again. */
    tileRefreshRequested: "dashboard.tile.refresh-requested",
} as const;

declare module "@terncosoftware/core-ui" {
    interface SystemCommands {
        "dashboard.tile.resize": ResizeTileArgs;
        "dashboard.tile.configure": ConfigureTileArgs;
        "dashboard.tile.reset": TileAddress;
        "dashboard.tile.refresh": TileAddress;
    }
    interface SystemEvents {
        "dashboard.tile.changed": TileState;
        "dashboard.tile.refresh-requested": TileAddress;
    }
}
