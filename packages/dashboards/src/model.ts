/** A tile's footprint on the dashboard grid, in cells. */
export interface TileSize {
    readonly cols: number;
    readonly rows: number;
}

/** The sizes a tile type allows. */
export interface TileSizeLimits {
    readonly default: TileSize;
    readonly min: TileSize;
    readonly max: TileSize;
}

/** Free-form, serializable settings a tile keeps between visits. */
export type TileSettings = Readonly<Record<string, unknown>>;

/** One tile placed on a dashboard. The same type may be placed any number of times. */
export interface TilePlacement {
    /** Unique within its dashboard; preferences are kept against it. */
    readonly id: string;
    /** A registered tile type, `<provider>:<name>`. */
    readonly type: string;
    readonly title?: string;
    /** Starting size, before the viewer resizes it. */
    readonly size?: TileSize;
    /** Starting settings, before the viewer changes them. */
    readonly settings?: TileSettings;
}

export interface DashboardDefinition {
    readonly id: string;
    readonly title: string;
    /** Grid width in cells. */
    readonly columns: number;
    readonly tiles: readonly TilePlacement[];
}

/** What one viewer has changed about one tile. */
export interface TilePreferences {
    readonly size?: TileSize;
    readonly settings?: TileSettings;
}

/** A tile as it renders right now: its placement with the viewer's preferences applied. */
export interface TileState {
    readonly dashboardId: string;
    readonly tileId: string;
    readonly type: string;
    readonly title: string;
    readonly size: TileSize;
    readonly settings: TileSettings;
}
