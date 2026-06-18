// @jasonscharf/ui-menus — config-driven menus for the core-ui composition shell.
//
// Menus are a higher-level concern layered on @jasonscharf/core-ui: a
// MenuRegistry collects contributed MenuItemConfigs (the menu analogue of
// core-ui's RegionRegistry), `assembleMenu` turns them into an ordered,
// capability-filtered tree, and the React MenuView (./react) renders that tree,
// activating items through core-ui's dispatch seam.
//
// Menus are also representable as quads: the urn:sys:ui: ontology defines the
// Menu / MenuItem entities, from which codegen emits the generated types + IRI
// constants re-exported below. The generated EntitySchemas (a persistence
// concern that pulls in @jasonscharf/entities, which is not browser-safe) live
// on the separate "@jasonscharf/ui-menus/schemas" entry so this barrel stays
// browser-safe.

export {
    assembleMenu,
    type MenuAssemblyOptions,
    type MenuItemConfig,
    type MenuNode,
} from "./menu.js";
export {
    type MenuContribution,
    MenuRegistry,
    type MenuRegistryOptions,
} from "./registry.js";
export {
    dispatchKindIRI,
    hasItemIRI,
    hasParentIRI,
    iconIRI,
    labelIRI,
    type Menu,
    MenuIRI,
    type MenuItem,
    MenuItemIRI,
    menuLabelIRI,
    menuSlotIRI,
    messageArgIRI,
    messageIRI,
    orderIRI,
    requiresIRI,
} from "./types.generated.js";
