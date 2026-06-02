/** A declared dependency on another extension. */
export interface TernRequirement {
    /** Name of the required extension. */
    readonly name: string;
}

/**
 * Opaque context passed to extension lifecycle hooks.
 * The host application injects whatever the extension needs
 * (store handle, services, config, etc.).
 */
export type TernExtensionContext = Record<string, unknown>;

/**
 * Formal contract for a Tern extension.
 *
 * Extensions declare their name, version, and optional dependencies.
 * The ExtensionManager (in @jasonscharf/server) drives the lifecycle:
 *   - install() on first boot
 *   - upgrade(from, to) when the installed version differs from this one
 *   - uninstall() when explicitly removed
 *
 * All hooks are idempotent by convention — they may be called multiple
 * times across deploys and must not produce inconsistent state.
 */
export interface TernExtension {
    readonly name: string;
    readonly version: string;
    readonly requires?: TernRequirement[];

    install(ctx: TernExtensionContext): Promise<void>;
    uninstall?(ctx: TernExtensionContext): Promise<void>;
    upgrade?(from: string, to: string, ctx: TernExtensionContext): Promise<void>;
}
