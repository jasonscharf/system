import type { TernExtension, TernExtensionContext } from "@jasonscharf/app";
import type { ExtensionRegistry } from "./ExtensionRegistry.js";
import type { ServerContext } from "./ServerContext.js";

/**
 * Coordinates TernExtension lifecycle against a persistent ExtensionRegistry.
 *
 * - install(ext): no-op if already at this version; calls upgrade() if version
 *   differs; calls install() on first boot.  Records the result in the registry.
 * - uninstall(ext): calls ext.uninstall() and removes the registry entry.
 * - installAll(exts): topologically sorts by `requires` and installs in order.
 */
export class ExtensionManager {
    constructor(
        private readonly _registry: ExtensionRegistry,
        private readonly _ctx: ServerContext,
        private readonly _extCtx: TernExtensionContext,
    ) {}

    async install(ext: TernExtension): Promise<void> {
        const existing = await this._registry.getVersion(this._ctx, ext.name);

        if (existing === ext.version) {
            return;
        }

        if (existing !== null) {
            if (ext.upgrade) {
                await ext.upgrade(existing, ext.version, this._extCtx);
            }
        } else {
            await ext.install(this._extCtx);
        }

        await this._registry.record(this._ctx, ext.name, ext.version);
    }

    async uninstall(ext: TernExtension): Promise<void> {
        const isInstalled = await this._registry.isInstalled(this._ctx, ext.name);
        if (!isInstalled) {
            return;
        }
        if (ext.uninstall) {
            await ext.uninstall(this._extCtx);
        }
        await this._registry.remove(this._ctx, ext.name);
    }

    async installAll(exts: TernExtension[]): Promise<void> {
        const sorted = _topoSort(exts);
        for (const ext of sorted) {
            await this.install(ext);
        }
    }
}

// ── Topological sort ──────────────────────────────────────────────────────────

function _topoSort(exts: TernExtension[]): TernExtension[] {
    const byName = new Map(exts.map((e) => [e.name, e]));
    const visited = new Set<string>();
    const result: TernExtension[] = [];

    function visit(ext: TernExtension): void {
        if (visited.has(ext.name)) {
            return;
        }
        for (const req of ext.requires ?? []) {
            const dep = byName.get(req.name);
            if (!dep) {
                throw new Error(
                    `Extension "${ext.name}" requires "${req.name}" which is not in the install set`,
                );
            }
            visit(dep);
        }
        visited.add(ext.name);
        result.push(ext);
    }

    for (const ext of exts) {
        visit(ext);
    }
    return result;
}
