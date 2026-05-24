import type { IRI } from "@jasonscharf/core";
import type { ShaclNodeShape } from "@jasonscharf/gen";
import type { EntityHandle } from "./Handle.js";

/**
 * Defines one PropGroup within an entity schema.
 *
 * `properties` maps TypeScript property names to their RDF IRI predicates.
 * These are the same IRIs emitted by `@system/gen` codegen (e.g. emailIRI).
 *
 * `shape` is an optional SHACL NodeShape for runtime validation.  When present,
 * `EntityStore` validates data against it before writing.
 */
export type DefaultValue<T> = T | (() => T);

export interface PropGroupDef<Props extends Record<string, unknown> = Record<string, unknown>> {
    readonly handle: EntityHandle;
    readonly properties: { readonly [K in keyof Props]: IRI };
    readonly shape?: ShaclNodeShape;
    /**
     * Default values applied during `EntityStore.create()` and `addGroup()` when
     * a property is absent from the supplied data.  Values may be static or
     * factory functions (called fresh per entity — use functions for `Date` etc.).
     *
     * In RDF/Turtle, defaults are expressed as `sh:defaultValue` on property
     * shapes and are read by the codegen into the generated `shapes.generated.ts`.
     */
    readonly defaults?: { readonly [K in keyof Props]?: DefaultValue<Props[K]> };
}

/**
 * Describes an entity type: its RDF class IRI, namespace, and registered PropGroups.
 *
 * `CoreProps` is the TypeScript type for the mandatory core PropGroup supplied at
 * construction time.  Extension packages add further groups via `register()`.
 *
 * Usage:
 *   export const UserSchema = new EntitySchema({ typeIRI: UserIRI, ns: AUTH_NS, coreGroup: { ... } });
 *   // later, at app boot:
 *   UserSchema.register(AnalyticsPropGroup);
 */
export class EntitySchema<CoreProps extends Record<string, unknown> = Record<string, unknown>> {
    readonly typeIRI: IRI;
    readonly ns: string;

    private readonly _groups = new Map<string, PropGroupDef>();

    constructor(opts: {
        typeIRI: IRI;
        ns: string;
        coreGroup: PropGroupDef<CoreProps>;
    }) {
        this.typeIRI = opts.typeIRI;
        this.ns = opts.ns;
        this._groups.set(opts.coreGroup.handle.id, opts.coreGroup);
    }

    /** Register an extension PropGroup. Called once at application startup. */
    register(group: PropGroupDef): void {
        this._groups.set(group.handle.id, group);
    }

    group(h: EntityHandle): PropGroupDef | undefined {
        return this._groups.get(h.id);
    }

    allGroups(): PropGroupDef[] {
        return [...this._groups.values()];
    }

    /** Returns the subset of registered groups matching the requested handles (or all if '*'). */
    resolveGroups(handles: EntityHandle[] | "*"): PropGroupDef[] {
        if (handles === "*") {
            return this.allGroups();
        }
        return handles.flatMap((h) => {
            const g = this._groups.get(h.id);
            return g ? [g] : [];
        });
    }
}
