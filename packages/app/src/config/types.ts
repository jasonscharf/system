/**
 * Configuration types for Tern applications and extensions.
 *
 * Configs are loaded from YAML or RDF (Turtle) files and merged in priority
 * order:  user-level  >  application  >  extension  >  defaults.
 */

import type { TripleStore } from "@jasonscharf/data";

/** One handler module registration for a named message type. */
export interface HandlerEntry {
    /** Full IRI of the SystemTypeRef this handler responds to. */
    readonly typeIri: string;
    /** Module specifier — a file path or URL resolved relative to the config file. */
    readonly module: string;
    /** Named export in the module that is the HandlerFn.  Defaults to "default". */
    readonly export?: string;
    /**
     * Handlers for the same type are executed in ascending priority order.
     * The first one that returns a successful result short-circuits the chain.
     * Default: 100.
     */
    readonly priority?: number;
}

/** Config for a single loadable extension (plugin). */
export interface ExtensionConfig {
    readonly name: string;
    readonly version?: string;
    readonly description?: string;
    readonly handlers: HandlerEntry[];
}

/**
 * Top-level application config.
 * Extensions are merged in list order; user-level handlers override all.
 */
export interface AppConfig {
    readonly name: string;
    readonly version?: string;
    readonly description?: string;
    readonly author?: string;
    readonly license?: string;
    /** Minimum @system/core version this config targets. */
    readonly ternVersion?: string;
    /**
     * Paths to extension config files (YAML or Turtle), relative to this
     * config file's directory.  Merged left-to-right; later extensions can
     * shadow earlier ones by registering handlers with lower priority numbers.
     */
    readonly extensions: string[];
    /**
     * User-level handler registrations — highest priority, merged last.
     * Use these to override individual extension handlers without forking the
     * extension config file.
     */
    readonly handlers: HandlerEntry[];
}

// ── Infrastructure extension lifecycle ───────────────────────────────────────

/**
 * Context passed to TernExtension.install() at application startup.
 */
export interface ExtensionInstallContext {
    /** Live triple store — use store.knex for schema migrations. */
    readonly store: TripleStore;
    /** Host application context supplied to SystemApp (e.g. { logger }). */
    readonly context: Record<string, unknown>;
    /**
     * Extensions already installed in dependency order.
     * Use this to obtain services from required extensions.
     */
    readonly extensions: ReadonlyMap<string, InstalledExtension>;
}

/**
 * The record of a successfully installed TernExtension, returned by
 * SystemApp.use().  Services are keyed by the name the extension chose.
 */
export interface InstalledExtension {
    readonly name: string;
    readonly version: string | undefined;
    /**
     * Runtime objects the extension exposes — e.g. { rbac: RbacService }.
     * Use the typed accessor helpers exported from each extension package
     * (getRbacService, getConvoService) to avoid manual casts.
     */
    readonly services: Record<string, unknown>;
}

/**
 * Contract for a Tern infrastructure extension.
 *
 * An infrastructure extension encapsulates everything needed to bring a
 * subsystem (RBAC, conversations, search, …) online: schema migrations,
 * seed data, service construction, and optional message handlers.
 *
 * Usage:
 *   const ternApp = await SystemApp.fromYAML(config, { context: { store } });
 *   const rbacInstalled  = await ternApp.use(rbacExtension);
 *   const convosInstalled = await ternApp.use(convosExtension);
 *   const rbac  = getRbacService(rbacInstalled);
 *   const convos = getConvoService(convosInstalled);
 *
 * Extension objects satisfy this interface through structural typing — they
 * do not need to import it.  Consuming apps that want the explicit type can
 * cast: `const ext: TernExtension = rbacExtension`.
 */
export interface TernExtension {
    readonly name: string;
    readonly version?: string;
    readonly description?: string;
    /**
     * Names of other TernExtension objects that must be installed via
     * SystemApp.use() before this one.  SystemApp enforces this order.
     */
    readonly requires?: readonly string[];
    /**
     * Called once at startup; must be idempotent (safe on every boot).
     * Returns the services this extension makes available to the rest of the
     * application.  Services are automatically merged into the HandlerContext
     * so message handlers can access them as ctx.rbac, ctx.convos, etc.
     */
    install?(ctx: ExtensionInstallContext): Promise<Record<string, unknown>>;
    upgrade?(from: string, to: string, ctx: ExtensionInstallContext): Promise<void>;
    uninstall?(ctx: ExtensionInstallContext): Promise<void>;
    /** Optional message handlers this extension contributes to the dispatcher. */
    handlers?: HandlerEntry[];
}
