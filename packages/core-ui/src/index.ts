// @jasonscharf/core-ui — a Prism-borrowed composition framework.
//
// Product packages contribute UI into a shell by CONFIGURATION, not hardcoded
// wiring. The pieces:
//   - regions:    named placeholders in the shell (RegionRegistry).
//   - views:      the unit of contributed UI, bound to a view-model.
//   - composition: the root that applies contributions and the shell reads from.
//   - dispatch:   the seam to the commands/queries/operations/events layer
//                 (TODO(TRN-229)).
//
// The React layer (./react) renders regions from a Composition. Menus are a
// separate, higher-level concern in @jasonscharf/ui-menus.

export {
    Composition,
    type CompositionOptions,
    type UiContribution,
} from "./composition.js";
export {
    type CommandHandle,
    type CommandImpl,
    type Dispatch,
    type DispatchKind,
    type EventListener,
    InMemoryDispatch,
    type RequestHandle,
    type RequestImpl,
    type RequestSig,
    type SystemCommands,
    type SystemEvents,
    type SystemOperations,
    type SystemQueries,
    type Unsubscribe,
} from "./dispatch.js";
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
