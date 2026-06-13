import type { ViewDefinition, ViewModel } from "./views.js";

/**
 * A region is a named placeholder in the shell. Product packages contribute
 * views into regions by name; the shell renders whatever has been contributed
 * without knowing in advance what that is. This is the heart of
 * composition-by-configuration.
 */
export interface RegionContribution {
    /** The region this contribution targets. */
    readonly region: string;
    /** The view contributed into the region. */
    readonly view: ViewDefinition;
    /**
     * Ordering hint within the region (ascending). Ties fall back to insertion
     * order. Defaults to 0.
     */
    readonly order?: number;
    /**
     * Optional predicate. When present and it returns false the contribution is
     * withheld from the region, enabling conditionally-contributed views. The
     * predicate is re-evaluated on every `viewsFor` call so config/state changes
     * recompose the region.
     */
    readonly when?: () => boolean;
}

interface StoredContribution {
    readonly contribution: RegionContribution;
    readonly seq: number;
}

/**
 * The region registry holds region contributions and answers "what views go in
 * region X right now". It is the composition substrate the shell reads from.
 *
 * Registration is additive and returns a disposer so packages can withdraw
 * their contributions (e.g. on unload), which recomposes affected regions.
 */
export class RegionRegistry {
    private readonly _byRegion = new Map<string, StoredContribution[]>();
    private _seq = 0;

    /**
     * Contribute a view into a region. Returns a disposer that removes this
     * contribution. Multiple contributions may target the same region.
     */
    contribute(contribution: RegionContribution): () => void {
        const stored: StoredContribution = { contribution, seq: this._seq++ };
        let list = this._byRegion.get(contribution.region);
        if (list === undefined) {
            list = [];
            this._byRegion.set(contribution.region, list);
        }
        list.push(stored);
        return () => {
            const current = this._byRegion.get(contribution.region);
            if (current === undefined) {
                return;
            }
            const idx = current.indexOf(stored);
            if (idx >= 0) {
                current.splice(idx, 1);
            }
            if (current.length === 0) {
                this._byRegion.delete(contribution.region);
            }
        };
    }

    /** All region names that currently have at least one contribution. */
    regions(): string[] {
        return [...this._byRegion.keys()];
    }

    /** True if the region has any (unfiltered) contributions registered. */
    hasRegion(region: string): boolean {
        return this._byRegion.has(region);
    }

    /**
     * The view definitions contributed to a region, in resolved order, with
     * `when` predicates applied. An unknown region yields an empty array (the
     * platform's "empty result" stance), so the shell can host any region name
     * safely.
     */
    viewsFor(region: string): ViewDefinition[] {
        const list = this._byRegion.get(region);
        if (list === undefined) {
            return [];
        }
        const visible = list.filter((entry) => {
            const when = entry.contribution.when;
            return when === undefined || when() === true;
        });
        visible.sort((a, b) => {
            const orderA = a.contribution.order ?? 0;
            const orderB = b.contribution.order ?? 0;
            if (orderA !== orderB) {
                return orderA - orderB;
            }
            return a.seq - b.seq;
        });
        return visible.map((entry) => entry.contribution.view);
    }

    /** Type-narrowing convenience: views for a region cast to a model type. */
    typedViewsFor<TModel extends ViewModel>(region: string): ViewDefinition<TModel>[] {
        return this.viewsFor(region) as ViewDefinition<TModel>[];
    }
}
