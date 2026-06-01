import { dirname, resolve } from "node:path";
import type { TernTypeRef } from "@jasonscharf/core";
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
    type HandlerContext,
    type HandlerFn,
    HandlerRegistry,
} from "./registry/HandlerRegistry.js";

export interface TernAppOptions {
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
 * TernApp — the top-level application object.
 *
 * Create via the static factory methods:
 *   TernApp.fromYAML('./config/app.yaml', options)
 *   TernApp.fromEntries([...handlerEntries], options)
 *
 * Install infrastructure extensions before starting:
 *   const rbacInstalled  = await app.use(rbacExtension);
 *   const convosInstalled = await app.use(convosExtension);
 *   const rbac  = getRbacService(rbacInstalled);
 *   const convos = getConvoService(convosInstalled);
 *
 * Then call `app.start()` to bring up the FBP runtime.
 */
export class TernApp {
    readonly config: AppConfig;
    readonly registry: HandlerRegistry;
    readonly flow: FlowApp;

    private readonly _extraContext: Record<string, unknown>;
    private readonly _installed = new Map<string, InstalledExtension>();

    private constructor(
        config: AppConfig,
        registry: HandlerRegistry,
        options: TernAppOptions = {},
    ) {
        this.config = config;
        this.registry = registry;
        this.flow = new FlowApp({ mode: options.mode ?? "push" });
        this._extraContext = { ...(options.context ?? {}) };
    }

    // ── Factories ─────────────────────────────────────────────────────────────

    /**
     * Load an application config from a YAML file, resolve all referenced
     * extension configs (YAML or Turtle), and return a ready-to-start TernApp.
     */
    static async fromYAML(configPath: string, options: TernAppOptions = {}): Promise<TernApp> {
        const absPath = resolve(configPath);
        const { config, resolvedHandlers } = await loadAppConfig(absPath);
        const registry = new HandlerRegistry(dirname(absPath));
        registry.registerAll(resolvedHandlers);
        return new TernApp(config, registry, options);
    }

    /**
     * Construct a TernApp directly from a flat list of HandlerEntries.
     * Useful for programmatic setup or testing without config files.
     */
    static fromEntries(
        config: AppConfig,
        entries: HandlerEntry[],
        options: TernAppOptions = {},
    ): TernApp {
        const registry = new HandlerRegistry(process.cwd());
        registry.registerAll(mergeHandlers([], entries));
        return new TernApp(config, registry, options);
    }

    // ── Extension lifecycle ───────────────────────────────────────────────────

    /**
     * Install a TernExtension and make its services available throughout the app.
     *
     * Installation is idempotent — calling `use()` with the same extension name
     * twice returns the cached result without re-running `install()`.
     *
     * Prerequisites listed in `extension.requires` must already be installed;
     * TernApp throws if they are not.
     *
     * Installed services are automatically merged into the HandlerContext so
     * message handlers can access them as `ctx.rbac`, `ctx.convos`, etc.
     *
     * Requires `{ store: TripleStore }` to be present in TernAppOptions.context.
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
                `Extension "${extension.name}" requires a TripleStore — pass { store } in TernApp context`,
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
    register(typeRef: TernTypeRef, handler: HandlerFn, priority?: number): this {
        this.registry.registerInline(typeRef, handler, priority);
        return this;
    }

    // ── Dispatch ──────────────────────────────────────────────────────────────

    /**
     * Dispatch a request with a caller-supplied connectionId.
     * Merges `options.context` with connectionId and passes it to the handler.
     */
    async dispatch(
        request: Parameters<HandlerRegistry["dispatch"]>[0],
        connectionId: string,
    ): ReturnType<HandlerRegistry["dispatch"]> {
        const ctx: HandlerContext = { connectionId, ...this._extraContext };
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
