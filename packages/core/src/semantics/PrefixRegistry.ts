/**
 * Manages prefixes for semantic identifiers.
 * These help shorten representations and reduce cognitive clutter.
 */
export class PrefixRegistry {
    private prefixes: Map<string, string>;

    constructor(initial?: Record<string, string>) {
        this.prefixes = new Map();
        if (initial) {
            for (const [p, ns] of Object.entries(initial)) {
                this.set(p, ns);
            }
        }
    }

    set(prefix: string, namespace: string): void {
        if (!/^[a-zA-Z_][\w-]*$/.test(prefix)) {
            throw new Error(`Invalid prefix: ${prefix}`);
        }

        if (!namespace || /\s/.test(namespace)) {
            throw new Error(`Invalid namespace IRI: ${namespace}`);
        }

        this.prefixes.set(prefix, namespace);
    }

    get(prefix: string): string | undefined {
        return this.prefixes.get(prefix);
    }

    has(prefix: string): boolean {
        return this.prefixes.has(prefix);
    }

    delete(prefix: string): void {
        this.prefixes.delete(prefix);
    }

    clear(): void {
        this.prefixes.clear();
    }

    /**
     * Expand ex:Thing → https://example.org/Thing
     */
    expand(prefixed: string): string {
        const idx = prefixed.indexOf(":");
        if (idx === -1) {
            throw new Error(`Not a prefixed name: ${prefixed}`);
        }

        const prefix = prefixed.slice(0, idx);
        const local = prefixed.slice(idx + 1);

        const ns = this.prefixes.get(prefix);
        if (!ns) {
            throw new Error(`Unknown prefix: ${prefix}`);
        }

        return ns + local;
    }

    /**
     * Compact an IRI if possible
     * Longest namespace wins
     */
    compact(iri: string): string | null {
        let bestPrefix: string | null = null;
        let bestNsLength = -1;

        for (const [prefix, ns] of this.prefixes) {
            if (iri.startsWith(ns) && ns.length > bestNsLength) {
                bestPrefix = prefix;
                bestNsLength = ns.length;
            }
        }

        if (!bestPrefix) return null;

        return `${bestPrefix}:${iri.slice(bestNsLength)}`;
    }

    /**
     * JSON-LD @context compatible
     */
    toJSON(): Record<string, string> {
        return Object.fromEntries(this.prefixes);
    }

    /**
     * Clone for safe scoping
     */
    clone(): PrefixRegistry {
        return new PrefixRegistry(this.toJSON());
    }
}
