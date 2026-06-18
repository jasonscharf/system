import { type Dispatch, InMemoryDispatch } from "./dispatch.js";
import { type RegionContribution, RegionRegistry } from "./regions.js";
import { type BoundView, bindView, type ViewDefinition, type ViewModel } from "./views.js";

/**
 * A contribution bundle: the configuration a product package hands to the
 * composition root. It is pure data + factories — no shell wiring — so the
 * shell is composed from configuration rather than imperative registration
 * spread across the app.
 *
 * Menus are NOT part of this bundle: they are a higher-level concern owned by
 * @jasonscharf/ui-menus (its MenuRegistry), which sits on top of core-ui.
 */
export interface UiContribution {
    /** Views contributed into named regions. */
    readonly regions?: RegionContribution[];
    /**
     * Optional hook to register command implementations / event listeners with
     * the dispatch seam when this contribution is applied.
     */
    readonly wire?: (dispatch: Dispatch) => void;
}

/**
 * Options for constructing a Composition.
 */
export interface CompositionOptions {
    /** Dispatch seam. Defaults to a fresh InMemoryDispatch. */
    readonly dispatch?: Dispatch;
}

/**
 * The composition root. It owns the region registry and the dispatch seam, and
 * applies UiContributions from product packages. The shell reads regions off
 * this object; nothing is hardcoded.
 *
 * Recomposition: contributions can be applied (and disposed) at any time. The
 * shell re-reads `viewsFor` to reflect the new composition, so a config change
 * recomposes the app.
 */
export class Composition {
    readonly regions = new RegionRegistry();
    readonly dispatch: Dispatch;

    constructor(options: CompositionOptions = {}) {
        this.dispatch = options.dispatch ?? new InMemoryDispatch();
    }

    /**
     * Apply a contribution bundle. Returns a disposer that withdraws everything
     * the bundle added (region views), recomposing affected regions.
     */
    apply(contribution: UiContribution): () => void {
        const disposers: Array<() => void> = [];

        for (const region of contribution.regions ?? []) {
            disposers.push(this.regions.contribute(region));
        }

        if (contribution.wire !== undefined) {
            contribution.wire(this.dispatch);
        }

        return () => {
            for (const dispose of disposers) {
                dispose();
            }
        };
    }

    /**
     * Bind every view contributed to a region, instantiating its view-model
     * against this composition's dispatch. The returned BoundViews are ready to
     * render in the order resolved by the region registry.
     */
    bindRegion<TOutput = unknown>(region: string): BoundView<ViewModel, TOutput>[] {
        return this.regions
            .viewsFor(region)
            .map((view: ViewDefinition) =>
                bindView<ViewModel, Record<string, unknown>, TOutput>(view, this.dispatch),
            );
    }
}
