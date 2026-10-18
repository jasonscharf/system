import type { TilePreferences } from "./model.js";

/** Preferences belong to one viewer on one dashboard. */
export interface PreferenceScope {
    readonly userId: string;
    readonly dashboardId: string;
}

/** Every tile's preferences in one scope, by tile id. */
export type DashboardPreferences = Readonly<Record<string, TilePreferences>>;

/** Where a viewer's tile preferences are kept. */
export interface TilePreferenceStore {
    load(scope: PreferenceScope): Promise<DashboardPreferences>;
    save(scope: PreferenceScope, preferences: DashboardPreferences): Promise<void>;
}

/** The parts of the Web Storage API the browser store uses. */
export interface KeyValueStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

const DEFAULT_PREFIX = "dashboards";

/**
 * Keeps preferences in the browser, one entry per viewer per dashboard. A
 * storage that is missing, full or blocked loses the preferences rather than
 * the dashboard, which renders from its defaults.
 */
export class BrowserTilePreferenceStore implements TilePreferenceStore {
    constructor(
        private readonly _storage: KeyValueStorage | null,
        private readonly _prefix = DEFAULT_PREFIX,
    ) {}

    private _key(scope: PreferenceScope): string {
        return `${this._prefix}:${scope.userId}:${scope.dashboardId}`;
    }

    async load(scope: PreferenceScope): Promise<DashboardPreferences> {
        try {
            const raw = this._storage?.getItem(this._key(scope)) ?? null;
            const parsed: unknown = raw === null ? null : JSON.parse(raw);
            return typeof parsed === "object" && parsed !== null
                ? (parsed as DashboardPreferences)
                : {};
        } catch {
            return {};
        }
    }

    async save(scope: PreferenceScope, preferences: DashboardPreferences): Promise<void> {
        try {
            this._storage?.setItem(this._key(scope), JSON.stringify(preferences));
        } catch {
            // Storage is full or blocked; the change still holds for this visit.
        }
    }
}

/** Keeps preferences in memory, for tests and for hosts with nowhere to put them. */
export class MemoryTilePreferenceStore implements TilePreferenceStore {
    private readonly _entries = new Map<string, DashboardPreferences>();

    async load(scope: PreferenceScope): Promise<DashboardPreferences> {
        return this._entries.get(`${scope.userId}:${scope.dashboardId}`) ?? {};
    }

    async save(scope: PreferenceScope, preferences: DashboardPreferences): Promise<void> {
        this._entries.set(`${scope.userId}:${scope.dashboardId}`, preferences);
    }
}
