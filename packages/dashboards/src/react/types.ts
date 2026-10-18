import type React from "react";
import type { TileState } from "../model.js";
import type { TileType } from "../TileTypeRegistry.js";

/** Everything a tile renders from. Changes go back through the dispatch commands. */
export interface TileProps {
    readonly tile: TileState;
}

/** A tile type drawn with React. */
export type ReactTileType = TileType<React.ComponentType<TileProps>>;
