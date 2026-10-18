import type { TileSizeLimits } from "./model.js";

/**
 * A kind of tile any provider can register. The dashboard knows nothing about
 * what a tile shows; it knows only these.
 *
 * `TRender` is whatever the rendering layer draws with, so this module stays
 * free of any UI framework.
 */
export interface TileType<TRender = unknown> {
    /** Namespaced by its provider, `<provider>:<name>`, so two providers never collide. */
    readonly type: string;
    readonly title: string;
    readonly description?: string;
    readonly size: TileSizeLimits;
    readonly render: TRender;
}

const TYPE_NAME = /^[a-z0-9-]+:[a-z0-9-]+$/;

export class TileTypeRegistry<TRender = unknown> {
    private readonly _types = new Map<string, TileType<TRender>>();

    /** Register a tile type. Returns a disposer that withdraws it. */
    register(tileType: TileType<TRender>): () => void {
        if (!TYPE_NAME.test(tileType.type)) {
            throw new Error(`Tile type "${tileType.type}" must be named <provider>:<name>`);
        }
        if (this._types.has(tileType.type)) {
            throw new Error(`Tile type "${tileType.type}" is already registered`);
        }
        this._types.set(tileType.type, tileType);
        return () => {
            if (this._types.get(tileType.type) === tileType) {
                this._types.delete(tileType.type);
            }
        };
    }

    get(type: string): TileType<TRender> | undefined {
        return this._types.get(type);
    }

    list(): TileType<TRender>[] {
        return [...this._types.values()];
    }
}
