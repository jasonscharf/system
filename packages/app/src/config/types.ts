/**
 * Configuration types for Tern applications and extensions.
 *
 * Configs are loaded from YAML or RDF (Turtle) files and merged in priority
 * order:  user-level  >  application  >  extension  >  defaults.
 */

/** One handler module registration for a named message type. */
export interface HandlerEntry {
    /** Full IRI of the TernTypeRef this handler responds to. */
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
