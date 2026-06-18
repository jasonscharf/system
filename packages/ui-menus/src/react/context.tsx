import type React from "react";
import { createContext, useContext } from "react";
import type { MenuRegistry } from "../registry.js";

/**
 * React context carrying the active MenuRegistry. The shell provides it once at
 * the root; MenuViews read it to discover what to render. Pairs with core-ui's
 * CompositionProvider (which supplies the dispatch seam menu items activate
 * through) and RevisionProvider (which drives recomposition).
 */
const MenuContext = createContext<MenuRegistry | null>(null);

export interface MenuProviderProps {
    readonly menus: MenuRegistry;
    readonly children: React.ReactNode;
}

/**
 * Provides a MenuRegistry to the React tree so MenuViews below render the
 * contributed menus purely from configuration.
 */
export function MenuProvider(props: MenuProviderProps): React.ReactElement {
    const { menus, children } = props;
    return <MenuContext.Provider value={menus}>{children}</MenuContext.Provider>;
}

/** Read the active MenuRegistry. Throws if used outside a MenuProvider. */
export function useMenus(): MenuRegistry {
    const menus = useContext(MenuContext);
    if (menus === null) {
        throw new Error("useMenus must be used within a MenuProvider");
    }
    return menus;
}
