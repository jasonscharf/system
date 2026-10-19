// @terncosoftware/dashboards: dashboards made of tiles that any provider registers.
//
// A dashboard knows only tile types. Tiles change through dispatch commands,
// so a tile, a toolbar or a test drives them the same way, and each viewer's
// changes are kept per dashboard. List tiles read live list topics through a
// source the host supplies.

export {
    type CommandRegistrar,
    DashboardRuntime,
    type DashboardRuntimeOptions,
    MountedDashboard,
} from "./DashboardRuntime.js";
export {
    type ListTopicHandle,
    type ListTopicListener,
    type ListTopicSource,
    type ListTopicSubscription,
    ListTopicView,
    type ListViewSnapshot,
    type ListViewStatus,
} from "./ListTopicView.js";
export { MemoryListTopicSource } from "./MemoryListTopicSource.js";
export {
    type ConfigureTileArgs,
    DashboardCommands,
    DashboardEvents,
    type ResizeTileArgs,
    type TileAddress,
} from "./messages.js";
export type {
    DashboardDefinition,
    TilePlacement,
    TilePreferences,
    TileSettings,
    TileSize,
    TileSizeLimits,
    TileState,
} from "./model.js";
export {
    BrowserTilePreferenceStore,
    type DashboardPreferences,
    type KeyValueStorage,
    MemoryTilePreferenceStore,
    type PreferenceScope,
    type TilePreferenceStore,
} from "./preferences.js";
export { type TileType, TileTypeRegistry } from "./TileTypeRegistry.js";
