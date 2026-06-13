import type { Ontology, OntologyClass, OntologyProperty } from "./OntologyReader.js";
import type { ShaclShapes } from "./ShaclReader.js";

/**
 * Emits runtime EntitySchema definitions from an ontology + SHACL shapes.
 *
 * The ontology already separates topology from data:
 *   owl:DatatypeProperty (sh:datatype) → a literal `properties` entry
 *   owl:ObjectProperty   (sh:class)    → a topological `edges` entry whose
 *                                        object is the target entity's IRI.
 *
 * This is what makes foreign-key destruction generator-driven: any property that
 * references another class becomes an edge, never a `fooId` scalar, mechanically.
 *
 * Containment is generator-driven too: an object property declared
 * `rdfs:subPropertyOf <CONTAINS_IRI>` becomes a `containment: true` edge and the
 * file ends with a `registerTopology(...)` call wiring those edges into the
 * tenant-rooted DAG (query path down, authorization scope chain up).  An object
 * property whose `rdfs:domain` is an *external* (base-ontology) class produces an
 * augmented "view" schema for that class carrying just the new edge — that is how
 * a containment edge attaches onto a class owned by another package (e.g. adding
 * `Domain --hasExperiment--> Experiment` onto core's tenancy:Domain).
 */

/** Well-known marker: an object property `rdfs:subPropertyOf` this IRI is a containment edge. */
export const CONTAINS_IRI = "urn:sys:core:contains";

export interface SchemaGenConfig {
    /** IRI prefix identifying classes/properties defined in this ontology. */
    localNamespace: string;
    /** Import path for EntitySchema.  Defaults to `@jasonscharf/entities`. */
    entitiesImport?: string;
    /** Import path for the IRI class.  Defaults to `@jasonscharf/core`. */
    iriImport?: string;
    /**
     * Absolute named-graph IRI to pin every generated schema to (graphIri).
     * Use for global-backbone ontologies like RBAC whose entities are not
     * tenant-scoped.
     */
    graphIri?: string;
    /** Per-class IRI path-segment overrides (class local name → segment), e.g. { UserGroup: "group" }. */
    idSegments?: Record<string, string>;
    /**
     * Maps an external (base-ontology) class IRI → the EntitySchema to import for
     * it.  Used when an edge targets a class owned by another package.
     */
    schemaImports?: Map<string, { importPath: string; schemaName: string }>;
    /**
     * IRI of the containment marker super-property.  An object property
     * `rdfs:subPropertyOf` this IRI is emitted as a `containment: true` edge.
     * Defaults to {@link CONTAINS_IRI}.
     */
    containsIri?: string;
    /**
     * Import path for `registerTopology`, used in the generated footer when the
     * ontology declares any containment edges.  Defaults to `@jasonscharf/server`.
     */
    topologyImport?: string;
}

function localName(iri: string): string {
    const hash = iri.lastIndexOf("#");
    const slash = iri.lastIndexOf("/");
    const colon = iri.lastIndexOf(":");
    return iri.slice(Math.max(hash, slash, colon) + 1);
}

/** The namespace prefix of an IRI (everything up to and including its last separator). */
function nsOf(iri: string): string {
    const hash = iri.lastIndexOf("#");
    const slash = iri.lastIndexOf("/");
    const colon = iri.lastIndexOf(":");
    return iri.slice(0, Math.max(hash, slash, colon) + 1);
}

function schemaConstName(classIri: string): string {
    return `${localName(classIri)}Schema`;
}

function maxCountFor(propIri: string, classIri: string, shapes: ShaclShapes): number | undefined {
    return shapes.byTargetClass.get(classIri)?.properties.find((p) => p.path === propIri)?.maxCount;
}

function isContainment(prop: OntologyProperty, config: SchemaGenConfig): boolean {
    const marker = config.containsIri ?? CONTAINS_IRI;
    return prop.superProperties.includes(marker);
}

interface ResolvedTarget {
    /** The schema const name to reference in the generated `target` thunk. */
    name: string;
    /** When the target is external (imported, not generated here), the import to emit. */
    import?: { importPath: string; schemaName: string };
}

function resolveTarget(
    rangeIri: string,
    config: SchemaGenConfig,
    generatedIris: Set<string>,
): ResolvedTarget | null {
    // A class generated in this file (local, or an augmented external view) is
    // referenced by a forward thunk — never imported.
    if (generatedIris.has(rangeIri) || rangeIri.startsWith(config.localNamespace)) {
        return { name: schemaConstName(rangeIri) };
    }
    const ext = config.schemaImports?.get(rangeIri);
    if (ext) {
        return { name: ext.schemaName, import: ext };
    }
    return null;
}

function renderEdge(
    prop: OntologyProperty,
    classIri: string,
    shapes: ShaclShapes,
    config: SchemaGenConfig,
    generatedIris: Set<string>,
): { line: string; import?: { importPath: string; schemaName: string } } {
    const cardinality = maxCountFor(prop.iri, classIri, shapes) === 1 ? "one" : "many";
    const containment = isContainment(prop, config);

    const target = prop.range ? resolveTarget(prop.range, config, generatedIris) : null;
    const fields = [`predicate: new IRI("${prop.iri}")`];
    if (target) {
        fields.push(`target: () => ${target.name}`);
    }
    fields.push(`cardinality: "${cardinality}"`, `direction: "out"`);
    if (containment) {
        fields.push("containment: true");
    }

    // A non-polymorphic edge whose target is neither local nor mapped is emitted
    // as a targetless link with a breadcrumb comment.
    const unmapped = prop.range !== null && target === null;
    const suffix = unmapped ? ` // target "${prop.range}" unmapped` : "";
    const line = `        ${prop.name}: { ${fields.join(", ")} },${suffix}`;
    return { line, import: target?.import };
}

function renderClass(
    cls: OntologyClass,
    isLocal: boolean,
    shapes: ShaclShapes,
    config: SchemaGenConfig,
    generatedIris: Set<string>,
    externalImports: Map<string, string>,
): { source: string; hasContainment: boolean } {
    // A local class emits all its properties.  An augmented external view emits
    // the class's own data properties plus the locally-declared properties (its
    // new edges) — but NOT base object properties, whose edges/targets belong to
    // the class's canonical schema in its owning package.
    const props = isLocal
        ? cls.properties
        : cls.properties.filter(
              (p) => p.kind === "data" || p.iri.startsWith(config.localNamespace),
          );
    const dataProps = props.filter((p) => p.kind === "data");
    const objectProps = props.filter((p) => p.kind === "object");

    const lines: string[] = [];
    if (cls.comment) {
        lines.push(`/** ${cls.comment} */`);
    }
    // Explicit annotation breaks the self-reference cycle for schemas whose edges
    // target themselves (e.g. ResourceNode.hasParent) — tsc rejects implicit-any
    // consts referenced in their own initializer.
    lines.push(`export const ${schemaConstName(cls.iri)}: EntitySchema = new EntitySchema({`);
    lines.push(`    typeIRI: new IRI("${cls.iri}"),`);
    lines.push(`    ns: "${isLocal ? config.localNamespace : nsOf(cls.iri)}",`);
    const segment = config.idSegments?.[localName(cls.iri)];
    if (segment) {
        lines.push(`    idSegment: "${segment}",`);
    }
    if (config.graphIri) {
        lines.push(`    graphIri: new IRI("${config.graphIri}"),`);
    }

    lines.push(`    properties: {`);
    for (const prop of dataProps) {
        // A PII-marked property is emitted as a PropertyDef carrying pii: true so
        // EntityStore encrypts it at rest; plain properties stay bare IRIs.
        if (prop.pii) {
            lines.push(`        ${prop.name}: { iri: new IRI("${prop.iri}"), pii: true },`);
        } else {
            lines.push(`        ${prop.name}: new IRI("${prop.iri}"),`);
        }
    }
    lines.push(`    },`);

    let hasContainment = false;
    const edgeLines: string[] = [];
    for (const prop of objectProps) {
        const rendered = renderEdge(prop, cls.iri, shapes, config, generatedIris);
        edgeLines.push(rendered.line);
        if (rendered.import) {
            externalImports.set(rendered.import.schemaName, rendered.import.importPath);
        }
        if (isContainment(prop, config)) {
            hasContainment = true;
        }
    }
    if (edgeLines.length > 0) {
        lines.push(`    edges: {`);
        lines.push(...edgeLines);
        lines.push(`    },`);
    }

    lines.push(`});`);
    return { source: lines.join("\n"), hasContainment };
}

/**
 * Generates a TypeScript source file of EntitySchema constants for every class in
 * the ontology that is local to `config.localNamespace` OR that an extension
 * property attaches an edge onto (an augmented external view).  Edge targets
 * generated in the same file are referenced via forward thunks; other external
 * targets are imported per `config.schemaImports`.  When any containment edge is
 * present, the file ends with a `registerTopology(...)` call.
 */
export function generateSchemas(
    ontology: Ontology,
    shapes: ShaclShapes,
    config: SchemaGenConfig,
): string {
    const entitiesPkg = config.entitiesImport ?? "@jasonscharf/entities";
    const iriPkg = config.iriImport ?? "@jasonscharf/core";
    const topologyPkg = config.topologyImport ?? "@jasonscharf/server";

    // A class is generated when it is local, or when an extension property declares
    // it as `rdfs:domain` (so an external class can gain a containment edge).
    const isLocalClass = (cls: OntologyClass) => cls.iri.startsWith(config.localNamespace);
    const hasLocalProp = (cls: OntologyClass) =>
        cls.properties.some((p) => p.iri.startsWith(config.localNamespace));
    const generated = [...ontology.classes.values()].filter(
        (cls) => isLocalClass(cls) || hasLocalProp(cls),
    );
    const generatedIris = new Set(generated.map((cls) => cls.iri));

    const externalImports = new Map<string, string>(); // schemaName → importPath
    const containmentSchemas: string[] = [];
    const body = generated
        .map((cls) => {
            const { source, hasContainment } = renderClass(
                cls,
                isLocalClass(cls),
                shapes,
                config,
                generatedIris,
                externalImports,
            );
            if (hasContainment) {
                containmentSchemas.push(schemaConstName(cls.iri));
            }
            return source;
        })
        .join("\n\n");

    const header: string[] = [
        `// auto-generated — do not edit by hand`,
        `import { EntitySchema } from "${entitiesPkg}";`,
        `import { IRI } from "${iriPkg}";`,
    ];
    if (containmentSchemas.length > 0) {
        header.push(`import { registerTopology } from "${topologyPkg}";`);
    }
    // Group external schema imports by package for stable, deduped output.
    const byPkg = new Map<string, Set<string>>();
    for (const [name, pkg] of externalImports) {
        if (!byPkg.has(pkg)) {
            byPkg.set(pkg, new Set());
        }
        byPkg.get(pkg)?.add(name);
    }
    for (const [pkg, names] of [...byPkg].sort(([a], [b]) => a.localeCompare(b))) {
        header.push(`import { ${[...names].sort().join(", ")} } from "${pkg}";`);
    }

    const footer =
        containmentSchemas.length > 0
            ? `\n\n// Wire containment edges into the tenant-rooted DAG (query path down, scope chain up).\nregisterTopology(${containmentSchemas.join(", ")});\n`
            : "\n";

    return `${header.join("\n")}\n\n${body}${footer}`;
}
