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
 */
export interface SchemaGenConfig {
    /** IRI prefix identifying classes/properties defined in this ontology. */
    localNamespace: string;
    /** Import path for EntitySchema.  Defaults to `@jasonscharf/entities`. */
    entitiesImport?: string;
    /** Import path for the IRI class.  Defaults to `@system/core`. */
    iriImport?: string;
    /**
     * Absolute named-graph IRI to pin every generated schema to (graphIri).
     * Use for global-backbone ontologies like RBAC whose entities are not
     * tenant-scoped.
     */
    graphIri?: string;
    /**
     * Maps an external (base-ontology) class IRI → the EntitySchema to import for
     * it.  Used when an edge targets a class owned by another package.
     */
    schemaImports?: Map<string, { importPath: string; schemaName: string }>;
}

function localName(iri: string): string {
    const hash = iri.lastIndexOf("#");
    const slash = iri.lastIndexOf("/");
    return iri.slice(Math.max(hash, slash) + 1);
}

function schemaConstName(classIri: string): string {
    return `${localName(classIri)}Schema`;
}

function maxCountFor(propIri: string, classIri: string, shapes: ShaclShapes): number | undefined {
    return shapes.byTargetClass.get(classIri)?.properties.find((p) => p.path === propIri)?.maxCount;
}

interface ResolvedTarget {
    /** The schema const name to reference in the generated `target` thunk. */
    name: string;
    /** When the target is external, the import to emit. */
    import?: { importPath: string; schemaName: string };
}

function resolveTarget(rangeIri: string, config: SchemaGenConfig): ResolvedTarget | null {
    if (rangeIri.startsWith(config.localNamespace)) {
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
): { line: string; import?: { importPath: string; schemaName: string } } | null {
    const cardinality = maxCountFor(prop.iri, classIri, shapes) === 1 ? "one" : "many";

    // Polymorphic edge (no rdfs:range) — a first-class topological link with no
    // single target type (e.g. a grant's principal: User | Group | ServiceAccount).
    if (!prop.range) {
        return {
            line:
                `        ${prop.name}: { predicate: new IRI("${prop.iri}"), ` +
                `cardinality: "${cardinality}", direction: "out" },`,
        };
    }

    const target = resolveTarget(prop.range, config);
    if (!target) {
        // Edge to an unmapped external class — emit as a targetless link with a breadcrumb.
        return {
            line:
                `        ${prop.name}: { predicate: new IRI("${prop.iri}"), ` +
                `cardinality: "${cardinality}", direction: "out" }, // target "${prop.range}" unmapped`,
        };
    }
    const line =
        `        ${prop.name}: { predicate: new IRI("${prop.iri}"), ` +
        `target: () => ${target.name}, cardinality: "${cardinality}", direction: "out" },`;
    return { line, import: target.import };
}

function renderClass(
    cls: OntologyClass,
    shapes: ShaclShapes,
    config: SchemaGenConfig,
    externalImports: Map<string, string>,
): string {
    const dataProps = cls.properties.filter((p) => p.kind === "data");
    const objectProps = cls.properties.filter((p) => p.kind === "object");

    const lines: string[] = [];
    if (cls.comment) {
        lines.push(`/** ${cls.comment} */`);
    }
    // Explicit annotation breaks the self-reference cycle for schemas whose edges
    // target themselves (e.g. ResourceNode.hasParent) — tsc rejects implicit-any
    // consts referenced in their own initializer.
    lines.push(`export const ${schemaConstName(cls.iri)}: EntitySchema = new EntitySchema({`);
    lines.push(`    typeIRI: new IRI("${cls.iri}"),`);
    lines.push(`    ns: "${config.localNamespace}",`);
    if (config.graphIri) {
        lines.push(`    graphIri: new IRI("${config.graphIri}"),`);
    }

    lines.push(`    properties: {`);
    for (const prop of dataProps) {
        lines.push(`        ${prop.name}: new IRI("${prop.iri}"),`);
    }
    lines.push(`    },`);

    const edgeLines: string[] = [];
    for (const prop of objectProps) {
        const rendered = renderEdge(prop, cls.iri, shapes, config);
        if (!rendered) {
            continue;
        }
        edgeLines.push(rendered.line);
        if (rendered.import) {
            externalImports.set(rendered.import.schemaName, rendered.import.importPath);
        }
    }
    if (edgeLines.length > 0) {
        lines.push(`    edges: {`);
        lines.push(...edgeLines);
        lines.push(`    },`);
    }

    lines.push(`});`);
    return lines.join("\n");
}

/**
 * Generates a TypeScript source file of EntitySchema constants for every local
 * class in the ontology.  Edge targets in the same namespace are referenced via
 * forward thunks; external targets are imported per `config.schemaImports`.
 */
export function generateSchemas(
    ontology: Ontology,
    shapes: ShaclShapes,
    config: SchemaGenConfig,
): string {
    const entitiesPkg = config.entitiesImport ?? "@jasonscharf/entities";
    const iriPkg = config.iriImport ?? "@system/core";

    const localClasses = [...ontology.classes.values()].filter((cls) =>
        cls.iri.startsWith(config.localNamespace),
    );

    const externalImports = new Map<string, string>(); // schemaName → importPath
    const body = localClasses
        .map((cls) => renderClass(cls, shapes, config, externalImports))
        .join("\n\n");

    const header: string[] = [
        `// auto-generated — do not edit by hand`,
        `import { EntitySchema } from "${entitiesPkg}";`,
        `import { IRI } from "${iriPkg}";`,
    ];
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

    return `${header.join("\n")}\n\n${body}\n`;
}
