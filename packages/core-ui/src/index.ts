// @jasonscharf/core-ui — a Prism-borrowed composition framework.
//
// Product packages contribute UI into a shell by CONFIGURATION, not hardcoded
// wiring. The pieces:
//   - regions:    named placeholders in the shell (RegionRegistry).
//   - views:      the unit of contributed UI, bound to a view-model.
//   - menu:       nav assembled from contributed config (assembleMenu).
//   - composition: the root that applies contributions and the shell reads from.
//   - dispatch:   the seam to the commands/events layer (TODO(TRN-229)).
//
// The React layer (./react) renders regions and menus from a Composition.

export {
    Composition,
    type CompositionOptions,
    type UiContribution,
} from "./composition.js";
export {
    type CommandHandle,
    type CommandImpl,
    type Dispatch,
    type EventListener,
    InMemoryDispatch,
    type Unsubscribe,
} from "./dispatch.js";
export {
    assembleMenu,
    type MenuAssemblyOptions,
    type MenuItemConfig,
    type MenuNode,
} from "./menu.js";
export {
    type RegionContribution,
    RegionRegistry,
} from "./regions.js";
export {
    type BoundView,
    bindView,
    type ViewDefinition,
    type ViewModel,
    type ViewModelContext,
    type ViewModelFactory,
    type ViewRenderer,
} from "./views.js";
