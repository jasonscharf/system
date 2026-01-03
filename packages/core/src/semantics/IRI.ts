import { PrefixRegistry } from './PrefixRegistry.js';


/**
 * An IRI is an internationalized URI used to identify members of semantic relationships.
 *
 * See RFC 3987 / RDF / OWL
 * RDF 1.1 compatible.
 */
export class IRI {
    private readonly _value: string;

    constructor(value: string) {
        this._value = value;
    }

    static from(value: string): IRI {
        if (!value) {
            throw new Error('IRI cannot be empty');
        }

        if (/\s/.test(value)) {
            throw new Error(`Invalid IRI (contains whitespace): ${value}`);
        }

        return new IRI(value);
    }

    static fromURN(nid: string, nss: string): IRI {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,31}$/.test(nid)) {
            throw new Error(`Invalid URN NID: ${nid}`);
        }

        if (!nss || /\s/.test(nss)) {
            throw new Error(`Invalid URN NSS: ${nss}`);
        }

        return new IRI(`urn:${nid}:${nss}`);
    }

    static fromPrefixed(prefixed: string, registry: PrefixRegistry): IRI {
        return new IRI(registry.expand(prefixed));
    }

    static resolve(
        relative: string | IRI,
        base: string | IRI
    ): IRI {
        const rel = relative instanceof IRI ? relative.value : relative;
        const b = base instanceof IRI ? base.value : base;

        if (rel.startsWith('urn:')) {
            return new IRI(rel);
        }

        try {
            return new IRI(new URL(rel, b).toString());
        } catch {
            throw new Error(`Failed to resolve IRI: ${rel} against base ${b}`);
        }
    }

    get value(): string {
        return this._value;
    }

    isAbsolute(): boolean {
        return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(this._value);
    }

    isURN(): boolean {
        return this._value.startsWith('urn:');
    }

    get urnParts():
        | IRINodeNamespacePair
        | null {

        if (!this.isURN()) {
            return null;
        }

        const [, nid, ...rest] = this._value.split(':');
        return { nid, nss: rest.join(':') };
    }

    toPrefixed(registry: PrefixRegistry): string | null {
        return registry.compact(this._value);
    }

    toRDF(): string {
        return `<${this._value}>`;
    }

    toJSON(): string {
        return this._value;
    }

    toString(): string {
        return this._value;
    }

    equals(other: IRI): boolean {
        return this._value === other._value;
    }
}

export interface IRINodeNamespacePair {
    nid: string;
    nss: string;
}
