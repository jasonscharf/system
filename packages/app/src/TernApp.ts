import { dirname, resolve } from "node:path";
import type { TernTypeRef } from "@jasonscharf/core";
import { FlowApp } from "@jasonscharf/flow";
import { loadAppConfig, mergeHandlers } from "./config/loader.js";
import type { AppConfig, HandlerEntry } from "./config/types.js";
import {
    type HandlerContext,
    type HandlerFn,
    HandlerRegistry,
} from "./registry/HandlerRegistry.js";

export interface TernAppOptions {
    /**
     * Extra context fields injected into every handler invocation alongside
     * the standard `connectionId`.  Use this to pass a database handle, logger,
     * feature flags, etc. without coupling handler modules to the host app.
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
 * Then call `app.start()` to bring up the FBP runtime.
 *
 * Example (full config-driven boot):
 *
 *   const app = await TernApp.fromYAML(
 *     fileURLToPath(new URL('./config/app.yaml', import.meta.url)),
 *     { context: { store: myTripleStore } },
 *   );
 *   await app.start();
 */
export class TernApp {
    readonly config: AppConfig;
    readonly registry: HandlerRegistry;
    readonly flow: FlowApp;

    private readonly _extraContext: Record<string, unknown>;

    private constructor(
        config: AppConfig,
        registry: HandlerRegistry,
        options: TernAppOptions = {},
    ) {
        this.config = config;
        this.registry = registry;
        this.flow = new FlowApp({ mode: options.mode ?? "push" });
        this._extraContext = options.context ?? {};
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
