import { IRI, literal, type Quad } from "@jasonscharf/core";
import type { ShaclNodeShape } from "@jasonscharf/gen";
import {
    RDF_TYPE,
    TERN_FIELD,
    TERN_FIELD_IRI,
    TERN_FIELD_NAME,
    TERN_HANDLE,
    TERN_PROP_GROUP,
    TERN_SCHEMA_GRAPH,
    XSD_STRING,
} from "./constants.js";
import { type EntityHandle, handleSlug } from "./Handle.js";
import { localName } from "./util.js";

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

    /**
     * Serialises this schema as RDF quads into the tern:schema named graph.
     *
     * Produces stable, IRI-based nodes (no blank nodes) so the result can be
     * round-tripped through the quad store and diffed on startup.
     *
     * Graph: TERN_SCHEMA_GRAPH
     * Subject IRIs:
     *   entity type  → typeIRI  (e.g. auth:User)
     *   prop group   → {schemaGraph}/{typeLocal}/{handleSlug}
     *   field        → {groupIRI}/{fieldName}
     */
    toQuads(): Quad[] {
        const OWL_CLASS = new IRI("http://www.w3.org/2002/07/owl#Class");
        const g = TERN_SCHEMA_GRAPH;
        const typeLocal = localName(this.typeIRI.value);
        const quads: Quad[] = [
            { subject: this.typeIRI, predicate: RDF_TYPE, object: OWL_CLASS, graph: g },
        ];

        for (const group of this._groups.values()) {
            const slug = handleSlug(group.handle);
            const pgNode = new IRI(`${TERN_SCHEMA_GRAPH.value}/${typeLocal}/${slug}`);

            quads.push(
                { subject: this.typeIRI, predicate: TERN_PROP_GROUP, object: pgNode, graph: g },
                {
                    subject: pgNode,
                    predicate: TERN_HANDLE,
                    object: literal(group.handle.toString(), XSD_STRING),
                    graph: g,
                },
            );

            for (const [fieldName, fieldIRI] of Object.entries(group.properties)) {
                const fieldNode = new IRI(`${pgNode.value}/${fieldName}`);
                quads.push(
                    { subject: pgNode, predicate: TERN_FIELD, object: fieldNode, graph: g },
                    {
                        subject: fieldNode,
                        predicate: TERN_FIELD_NAME,
                        object: literal(fieldName, XSD_STRING),
                        graph: g,
                    },
                    {
                        subject: fieldNode,
                        predicate: TERN_FIELD_IRI,
                        object: fieldIRI as IRI,
                        graph: g,
                    },
                );
            }
        }

        return quads;
    }
}
