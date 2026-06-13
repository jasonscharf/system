/**
 * A single contributed menu item. Serializable config — no functions — so menus
 * can be assembled from data (RDF/quads, JSON config, etc.) per the platform's
 * configuration-driven stance. Activation is expressed as a command name +
 * argument that flow through the Dispatch seam, not as an inline handler.
 */
export interface MenuItemConfig {
    readonly id: string;
    readonly label: string;
    /** Optional parent item id; absent means top-level. */
    readonly parent?: string | null;
    /** Ordering within siblings (ascending). Defaults to 0. */
    readonly order?: number;
    /**
     * Command dispatched when the item is activated. Absent for pure grouping
     * items (e.g. a section header that only contains children).
     */
    readonly command?: string | null;
    /** Serializable argument passed to the command on activation. */
    readonly commandArg?: unknown;
    /**
     * Optional capability/feature flag gate. When the assembling caller supplies
     * a set of granted capabilities, an item whose `requires` is not in that set
     * is omitted, enabling config-driven conditional menus.
     */
    readonly requires?: string | null;
    /** Optional icon name (resolved by the renderer). */
    readonly icon?: string | null;
}

/**
 * A resolved menu node: a config item with its children nested. This is the
 * tree the menu renderer walks.
 */
export interface MenuNode {
    readonly item: MenuItemConfig;
    readonly children: MenuNode[];
}

/**
 * Options controlling menu assembly.
 */
export interface MenuAssemblyOptions {
    /**
     * Granted capabilities. When provided, items whose `requires` is set and not
     * present are dropped (along with their subtrees). When omitted, no items are
     * gated out.
     */
    readonly capabilities?: ReadonlySet<string>;
}

function sortNodes(nodes: MenuNode[]): void {
    nodes.sort((a, b) => (a.item.order ?? 0) - (b.item.order ?? 0));
    for (const node of nodes) {
        sortNodes(node.children);
    }
}

/**
 * Assemble a flat list of contributed menu item configs into an ordered,
 * capability-filtered tree. This is the config-driven menu assembly step: nav
 * is data, assembled here, never hardcoded.
 *
 * Rules:
 * - Items are grouped by `parent`; missing/null parent are top-level.
 * - Items referencing a parent that was filtered out (or never existed) are
 *   dropped, so a gated section hides its whole subtree.
 * - Siblings are ordered by `order` then declaration order.
 */
export function assembleMenu(
    items: MenuItemConfig[],
    options: MenuAssemblyOptions = {},
): MenuNode[] {
    const capabilities = options.capabilities;
    const allowed = items.filter((item) => {
        const requires = item.requires;
        if (requires === undefined || requires === null) {
            return true;
        }
        return capabilities?.has(requires) === true;
    });

    const nodes = new Map<string, MenuNode>();
    for (const item of allowed) {
        nodes.set(item.id, { item, children: [] });
    }

    const roots: MenuNode[] = [];
    for (const item of allowed) {
        const node = nodes.get(item.id) as MenuNode;
        const parentId = item.parent;
        if (parentId === undefined || parentId === null) {
            roots.push(node);
            continue;
        }
        const parent = nodes.get(parentId);
        if (parent === undefined) {
            // Parent was filtered out or does not exist: drop the orphan subtree.
            continue;
        }
        parent.children.push(node);
    }

    sortNodes(roots);
    return roots;
}
