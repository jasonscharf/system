import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The result of resolving a `module://` URI.
 *
 * `fn`   — the resolved callable (already bound to its receiver when the
 *          member came from the module's default export).
 * `args` — the query-string bag baked into the URI, kept as raw strings;
 *          callers are responsible for coercing values to their expected types.
 */
export interface ResolvedRef {
    readonly fn: (...args: unknown[]) => unknown;
    readonly args: Record<string, string>;
}

/**
 * Internal cache key → resolved entry.
 *
 * We cache at the URI level so repeat calls with the same URI skip the
 * dynamic import and member lookup.
 */
const _cache = new Map<string, ResolvedRef>();

/**
 * Parse and resolve a `module://` handler reference URI into a callable and
 * its bind-time argument bag.
 *
 * URI grammar:
 *   module://<specifier>[#<member>][?<query>]
 *
 * Where:
 *   <specifier>  — npm package (possibly scoped: `@scope/pkg/sub.js`), a
 *                  relative path (`./foo.js`), or a `file://` URL.  Everything
 *                  between `module://` and the first `#` or `?` is treated as
 *                  an opaque specifier — we do NOT use `new URL()` here because
 *                  the WHATWG URL parser misreads `@scope` as URL user-info and
 *                  mangles scoped npm package names.
 *   <member>     — optional fragment: preferred as a named export on the
 *                  module; falls back to a method on `module.default`.
 *   <query>      — optional query string (standard `key=value&…`); parsed into
 *                  `Record<string, string>` via `URLSearchParams`.
 *
 * Member resolution order:
 *   1. If `#member` is present, try `mod[member]` (named export).
 *   2. Else if `mod.default[member]` exists and is a function, use that
 *      (bound to `mod.default`).
 *   3. If no `#member`, use `mod.default` directly (must be callable).
 *
 * @param uri      The `module://` URI to resolve.
 * @param baseDir  Optional base directory for resolving relative specifiers
 *                 (e.g. `./handler.js`).  Defaults to `process.cwd()`.
 */
export async function resolveModuleRef(
    uri: string,
    baseDir: string = process.cwd(),
): Promise<ResolvedRef> {
    const cached = _cache.get(uri);
    if (cached != null) {
        return cached;
    }

    const { specifier, member, args } = _parseUri(uri);
    const moduleUrl = _resolveSpecifier(specifier, baseDir);

    // Dynamic import — vite-ignore keeps bundlers from trying to analyse it.
    const mod = (await import(/* @vite-ignore */ moduleUrl)) as Record<string, unknown>;

    const fn = _resolveMember(mod, member, moduleUrl);

    const resolved: ResolvedRef = { fn, args };
    _cache.set(uri, resolved);
    return resolved;
}

/**
 * Clear the internal module-member cache.
 *
 * Intended for test use only — production code should never need this.
 */
export function _clearModuleRefCache(): void {
    _cache.clear();
}

// ── Parsing ───────────────────────────────────────────────────────────────────

const MODULE_SCHEME = "module://";

interface ParsedUri {
    specifier: string;
    member: string | undefined;
    args: Record<string, string>;
}

function _parseUri(uri: string): ParsedUri {
    if (!uri.startsWith(MODULE_SCHEME)) {
        throw new Error(
            `resolveModuleRef: URI must start with "module://" — got: ${JSON.stringify(uri)}`,
        );
    }

    // Everything after "module://" up to the first "#" or "?"
    const rest = uri.slice(MODULE_SCHEME.length);

    if (rest.length === 0) {
        throw new Error(`resolveModuleRef: URI has no module specifier: ${JSON.stringify(uri)}`);
    }

    // Find the split points for fragment and query.
    const hashIdx = rest.indexOf("#");
    const qIdx = rest.indexOf("?");

    // The specifier ends at the first separator (or end of string).
    const specEnd = _firstPositive(hashIdx, qIdx) ?? rest.length;
    const specifier = rest.slice(0, specEnd);

    if (specifier.length === 0) {
        throw new Error(`resolveModuleRef: URI has empty module specifier: ${JSON.stringify(uri)}`);
    }

    let member: string | undefined;
    let args: Record<string, string> = {};

    if (hashIdx !== -1) {
        // fragment is between "#" and next "?" (or end)
        const fragEnd = qIdx !== -1 && qIdx > hashIdx ? qIdx : rest.length;
        member = rest.slice(hashIdx + 1, fragEnd);
        if (member.length === 0) {
            member = undefined;
        }
    }

    if (qIdx !== -1) {
        const queryStr = rest.slice(qIdx + 1);
        args = Object.fromEntries(new URLSearchParams(queryStr).entries());
    }

    return { specifier, member, args };
}

function _firstPositive(...values: number[]): number | undefined {
    const positive = values.filter((v) => v !== -1);
    if (positive.length === 0) {
        return undefined;
    }
    return Math.min(...positive);
}

// ── Specifier resolution ──────────────────────────────────────────────────────

function _resolveSpecifier(specifier: string, baseDir: string): string {
    // Already a file:// URL — pass through.
    if (specifier.startsWith("file://")) {
        return specifier;
    }

    // Relative path — resolve against baseDir, convert to file:// URL.
    if (specifier.startsWith(".")) {
        return pathToFileURL(resolve(baseDir, specifier)).href;
    }

    // npm package (possibly scoped) or absolute path — keep as-is and let
    // the Node.js ESM loader handle it.
    return specifier;
}

// ── Member resolution ─────────────────────────────────────────────────────────

function _resolveMember(
    mod: Record<string, unknown>,
    member: string | undefined,
    moduleUrl: string,
): (...args: unknown[]) => unknown {
    if (member == null) {
        // No fragment — use default export directly.
        if (typeof mod.default === "function") {
            return mod.default as (...args: unknown[]) => unknown;
        }
        throw new Error(`resolveModuleRef: module "${moduleUrl}" has no callable default export`);
    }

    // Try named export first.
    if (Object.hasOwn(mod, member)) {
        const named = mod[member];
        if (typeof named !== "function") {
            throw new Error(
                `resolveModuleRef: named export "${member}" in "${moduleUrl}" is not a function`,
            );
        }
        return named as (...args: unknown[]) => unknown;
    }

    // Fall back to method on default export.
    const def = mod.default;
    if (
        def != null &&
        typeof def === "object" &&
        typeof (def as Record<string, unknown>)[member] === "function"
    ) {
        const method = (def as Record<string, unknown>)[member] as (...args: unknown[]) => unknown;
        return method.bind(def);
    }

    throw new Error(
        `resolveModuleRef: no named export or default-export method "${member}" found in "${moduleUrl}"`,
    );
}
