import {
    assembleMenu,
    type MenuAssemblyOptions,
    type MenuItemConfig,
    type MenuNode,
} from "./menu.js";

/**
 * A menu contribution bundle: the menu items a product package hands to the
 * registry. Pure, serializable data — no shell wiring — so menus are composed
 * from configuration. Mirrors core-ui's region contribution model.
 */
export interface MenuContribution {
    /** Menu item configs merged into the registry. */
    readonly menu?: MenuItemConfig[];
}

/**
 * Options for constructing a MenuRegistry.
 */
export interface MenuRegistryOptions {
    /** Menu assembly options (capability gating) applied to every `assemble`. */
    readonly menu?: MenuAssemblyOptions;
}

/**
 * Holds contributed menu items and answers "what does menu/slot X look like
 * right now". This is the menu analogue of core-ui's RegionRegistry: the
 * composition substrate the React MenuView reads from.
 *
 * Contribution is additive and returns a disposer so packages can withdraw
 * their items (e.g. on unload), which recomposes affected menus.
 */
export class MenuRegistry {
    private readonly _items: MenuItemConfig[] = [];
    private readonly _options: MenuAssemblyOptions;

    constructor(options: MenuRegistryOptions = {}) {
        this._options = options.menu ?? {};
    }

    /**
     * Contribute menu items. Returns a disposer that removes exactly the items
     * added by this call. Multiple contributions accumulate.
     */
    contribute(items: MenuItemConfig[]): () => void {
        for (const item of items) {
            this._items.push(item);
        }
        return () => {
            for (const item of items) {
                const idx = this._items.indexOf(item);
                if (idx >= 0) {
                    this._items.splice(idx, 1);
                }
            }
        };
    }

    /** Apply a contribution bundle; convenience over `contribute`. */
    apply(contribution: MenuContribution): () => void {
        return this.contribute(contribution.menu ?? []);
    }

    /**
     * Assemble the current menu tree for a slot (or the default unnamed menu),
     * applying this registry's capability gating. An unknown slot yields an
     * empty tree.
     */
    assemble(slot?: string): MenuNode[] {
        return assembleMenu(this._items, { ...this._options, slot });
    }
}
