/**
 * An EntityHandle is the stable identity for a PropGroup.
 *
 * It encodes a domain-scoped id and a version number so breaking changes to a
 * PropGroup's shape are made explicit.  The handle coerces to its string form
 * (`id@version`) so it can be used as a Map key, an object key, or logged.
 *
 * Convention:
 *   Platform groups use the `tern:` prefix  — e.g.  handle('tern:core')
 *   Third-party groups use reverse-domain   — e.g.  handle('com.myapp.billing')
 */
export interface EntityHandle {
    readonly id: string;
    readonly version: number;
    readonly symbol: symbol;
    toString(): string;
}

export function handle(id: string, version = 1): EntityHandle {
    const str = `${id}@${version}`;
    const sym = Symbol.for(str);
    return Object.freeze({
        id,
        version,
        symbol: sym,
        toString: () => str,
        [Symbol.toPrimitive]: () => str,
    }) as EntityHandle;
}

/** Slugified handle string safe for embedding in IRIs (colons and dots replaced). */
export function handleSlug(h: EntityHandle): string {
    return `${h.id.replace(/[^a-zA-Z0-9.-]/g, "_")}_v${h.version}`;
}
