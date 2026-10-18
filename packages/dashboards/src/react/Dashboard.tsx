import type React from "react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { MountedDashboard } from "../DashboardRuntime.js";
import type { DashboardDefinition } from "../model.js";
import { useDashboardHost } from "./context.js";
import { TileFrame } from "./TileFrame.js";
import type { ReactTileType } from "./types.js";

export interface DashboardProps {
    readonly definition: DashboardDefinition;
    /** Whose preferences to load and keep. */
    readonly userId: string;
}

function Tiles(props: { mounted: MountedDashboard }): React.ReactNode {
    const { mounted } = props;
    const { runtime } = useDashboardHost();
    const tiles = useSyncExternalStore(mounted.subscribe, mounted.tiles, mounted.tiles);
    return tiles.map((tile) => {
        const Render = (runtime.tileTypes.get(tile.type) as ReactTileType | undefined)?.render;
        return (
            <TileFrame
                key={tile.tileId}
                tile={tile}
                columns={mounted.definition.columns}
                limits={mounted.limitsFor(tile.tileId)}
            >
                {Render ? (
                    <Render tile={tile} />
                ) : (
                    <p className="dboard-tile__empty">Unknown tile type {tile.type}</p>
                )}
            </TileFrame>
        );
    });
}

/**
 * A grid of tiles. It mounts the definition for one viewer, renders each tile
 * through its registered type, and re-renders as commands change the tiles.
 */
export function Dashboard(props: DashboardProps): React.ReactElement {
    const { definition, userId } = props;
    const { runtime } = useDashboardHost();
    const [mounted, setMounted] = useState<MountedDashboard | null>(null);
    const [failed, setFailed] = useState<string | null>(null);

    useEffect(() => {
        let current: MountedDashboard | null = null;
        let live = true;
        const mount = async (): Promise<void> => {
            try {
                const next = await runtime.mount(definition, userId);
                if (!live) {
                    next.unmount();
                    return;
                }
                current = next;
                setMounted(next);
            } catch (err) {
                setFailed(err instanceof Error ? err.message : String(err));
            }
        };
        mount();
        return () => {
            live = false;
            current?.unmount();
        };
    }, [runtime, definition, userId]);

    return (
        <section
            className="dboard"
            aria-label={definition.title}
            aria-busy={mounted === null}
            data-testid={`dashboard-${definition.id}`}
            style={{ "--dboard-columns": definition.columns } as React.CSSProperties}
        >
            {failed ? (
                <p className="dboard__error" role="alert">
                    {failed}
                </p>
            ) : (
                mounted && <Tiles mounted={mounted} />
            )}
        </section>
    );
}
