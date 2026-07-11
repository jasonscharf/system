import { dirname, resolve } from "node:path";
import { anonymousSec, type SecurityContext, type SystemTypeRef } from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import { FlowApp } from "@jasonscharf/flow";
import { loadAppConfig, mergeHandlers } from "./config/loader.js";
import type {
    AppConfig,
    ExtensionInstallContext,
    HandlerEntry,
    InstalledExtension,
    TernExtension,
} from "./config/types.js";
import {
    type HandlerContextInput,
    type HandlerFn,
    HandlerRegistry,
} from "./registry/HandlerRegistry.js";

export interface SystemAppOptions {
    /**
     * Extra context fields injected into every handler invocation alongside
     * the standard `connectionId`.  Pass `{ store }` here and all installed
     * extension services (rbac, convos, …) will be automatically merged in.
     */
    context?: Record<string, unknown>;
    /** Scheduler mode for the underlying FBP runtime. */
    mode?: "push" | "pull";
}

/**
 * SystemApp — the top-level application object.
 *
 * Create via the static factory methods:
 *   SystemApp.fromYAML('./config/app.yaml', options)
 *   SystemApp.fromEntries([...handlerEntries], options)
 *
 * Install infrastructure extensions before starting:
 *   const rbacInstalled  = await app.use(rbacExtension);
 *   const convosInstalled = await app.use(convosExtension);
 *   const rbac  = getRbacService(rbacInstalled);
 *   const convos = getConvoService(convosInstalled);
 *
 * Then call `app.start()` to bring up the FBP runtime.
 */
export class SystemApp {
    readonly config: AppConfig;
    readonly registry: HandlerRegistry;
    readonly flow: FlowApp;

    private readonly _extraContext: Record<string, unknown>;
    private readonly _installed = new Map<string, InstalledExtension>();

    private constructor(
        config: AppConfig,
        registry: HandlerRegistry,
        options: SystemAppOptions = {},
    ) {
        this.config = config;
        this.registry = registry;
        this.flow = new FlowApp({ mode: options.mode ?? "push" });
        this._extraContext = { ...(options.context ?? {}) };
    }

    // ── Factories ─────────────────────────────────────────────────────────────

    /**
     * Load an application config from a YAML file, resolve all referenced
     * extension configs (YAML or Turtle), and return a ready-to-start SystemApp.
     */
    static async fromYAML(configPath: string, options: SystemAppOptions = {}): Promise<SystemApp> {
        const absPath = resolve(configPath);
        const { config, resolvedHandlers } = await loadAppConfig(absPath);
        const registry = new HandlerRegistry(dirname(absPath));
        registry.registerAll(resolvedHandlers);
        return new SystemApp(config, registry, options);
    }

    /**
     * Construct a SystemApp directly from a flat list of HandlerEntries.
     * Useful for programmatic setup or testing without config files.
     */
    static fromEntries(
        config: AppConfig,
        entries: HandlerEntry[],
        options: SystemAppOptions = {},
    ): SystemApp {
        const registry = new HandlerRegistry(process.cwd());
        registry.registerAll(mergeHandlers([], entries));
        return new SystemApp(config, registry, options);
    }

    // ── Extension lifecycle ───────────────────────────────────────────────────

    /**
     * Install a TernExtension and make its services available throughout the app.
     *
     * Installation is idempotent — calling `use()` with the same extension name
     * twice returns the cached result without re-running `install()`.
     *
     * Prerequisites listed in `extension.requires` must already be installed;
     * SystemApp throws if they are not.
     *
     * Installed services are automatically merged into the HandlerContext so
     * message handlers can access them as `ctx.rbac`, `ctx.convos`, etc.
     *
     * Requires `{ store: TripleStore }` to be present in SystemAppOptions.context.
     */
    async use(extension: TernExtension): Promise<InstalledExtension> {
        const existing = this._installed.get(extension.name);
        if (existing) {
            return existing;
        }

        for (const dep of extension.requires ?? []) {
            if (!this._installed.has(dep)) {
                throw new Error(
                    `Extension "${extension.name}" requires "${dep}" — install it first with app.use(${dep.replace("tern.", "")}Extension)`,
                );
            }
        }

        const store = this._extraContext.store as TripleStore | undefined;
        if (!store) {
            throw new Error(
                `Extension "${extension.name}" requires a TripleStore — pass { store } in SystemApp context`,
            );
        }

        const installCtx: ExtensionInstallContext = {
            store,
            context: this._extraContext,
            extensions: this._installed,
        };

        let services: Record<string, unknown> = {};
        if (extension.install) {
            services = await extension.install(installCtx);
        }

        const installed: InstalledExtension = {
            name: extension.name,
            version: extension.version,
            services,
        };

        this._installed.set(extension.name, installed);

        // Merge services into extra context so all handlers can access them
        Object.assign(this._extraContext, services);

        if (extension.handlers) {
            this.registry.registerAll(extension.handlers);
        }

        return installed;
    }

    // ── Registration ──────────────────────────────────────────────────────────

    /** Register an inline handler — useful for host-app defaults not in config. */
    register(typeRef: SystemTypeRef, handler: HandlerFn, priority?: number): this {
        this.registry.registerInline(typeRef, handler, priority);
        return this;
    }

    // ── Dispatch ──────────────────────────────────────────────────────────────

    /**
     * Dispatch a request with a caller-supplied connectionId.
     * Merges `options.context` with connectionId and passes it to the handler.
     *
     * `sec` is the principal the handler reads off `ctx.sec`; it defaults to
     * `anonymousSec` so an unauthenticated caller dispatches as anonymous.  The
     * WS-auth path (TRN-527) resolves the real principal per connection and
     * passes it (and `tenantId`) here.
     */
    async dispatch(
        request: Parameters<HandlerRegistry["dispatch"]>[0],
        connectionId: string,
        sec: SecurityContext = anonymousSec,
        tenantId: string | null = null,
    ): ReturnType<HandlerRegistry["dispatch"]> {
        const ctx: HandlerContextInput = { ...this._extraContext, connectionId, sec, tenantId };
        return this.registry.dispatch(request, ctx);
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    async start(): Promise<void> {
        await this.flow.start();
        this.flow.scheduler.start();
    }

    async stop(): Promise<void> {
        await this.flow.stop();
    }
}
