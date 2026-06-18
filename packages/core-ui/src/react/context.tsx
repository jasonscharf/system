import type React from "react";
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { Composition } from "../composition.js";

/**
 * React context carrying the active Composition. The shell provides it once at
 * the root; region hosts read it to discover what to render (and ui-menus reads
 * its dispatch seam to activate menu items).
 */
const CompositionContext = createContext<Composition | null>(null);

export interface CompositionProviderProps {
    readonly composition: Composition;
    readonly children: React.ReactNode;
}

/**
 * Provides a Composition to the React tree. Everything below can host regions
 * purely from configuration.
 */
export function CompositionProvider(props: CompositionProviderProps): React.ReactElement {
    const { composition, children } = props;
    return (
        <CompositionContext.Provider value={composition}>{children}</CompositionContext.Provider>
    );
}

/** Read the active Composition. Throws if used outside a CompositionProvider. */
export function useComposition(): Composition {
    const composition = useContext(CompositionContext);
    if (composition === null) {
        throw new Error("useComposition must be used within a CompositionProvider");
    }
    return composition;
}

/**
 * A tiny revision store so the shell can force a re-read of the composition
 * after a config change (recomposition). Bumping the revision re-renders all
 * region hosts and menus. This keeps recomposition explicit and serializable —
 * no hidden reactivity in the core.
 */
export class CompositionRevision {
    private _rev = 0;
    private readonly _listeners = new Set<() => void>();

    bump(): void {
        this._rev++;
        for (const listener of this._listeners) {
            listener();
        }
    }

    subscribe = (listener: () => void): (() => void) => {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    };

    snapshot = (): number => this._rev;
}

const RevisionContext = createContext<CompositionRevision | null>(null);

export interface RevisionProviderProps {
    readonly revision: CompositionRevision;
    readonly children: React.ReactNode;
}

export function RevisionProvider(props: RevisionProviderProps): React.ReactElement {
    const { revision, children } = props;
    return <RevisionContext.Provider value={revision}>{children}</RevisionContext.Provider>;
}

/**
 * Subscribe the calling component to recomposition. Returns the current
 * revision; the value itself is unimportant, the subscription is what triggers
 * re-render when `bump()` is called.
 */
export function useRevision(): number {
    const revision = useContext(RevisionContext);
    const subscribe = useMemo(() => revision?.subscribe ?? (() => () => {}), [revision]);
    const snapshot = useMemo(() => revision?.snapshot ?? (() => 0), [revision]);
    return useSyncExternalStore(subscribe, snapshot, snapshot);
}
