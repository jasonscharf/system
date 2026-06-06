import type { Ontology, OntologyClass, OntologyProperty } from "./OntologyReader.js";
import type { ShaclShapes } from "./ShaclReader.js";

const XSD_PREFIX = "http://www.w3.org/2001/XMLSchema#";

const XSD_TO_TS: Record<string, string> = {
    string: "string",
    boolean: "boolean",
    integer: "number",
    decimal: "number",
    float: "number",
    double: "number",
    long: "number",
    int: "number",
    short: "number",
    byte: "number",
    dateTime: "Date",
    date: "Date",
    anyURI: "string",
};

function xsdToTs(rangeIRI: string | null): string {
    if (!rangeIRI) {
        return "unknown";
    }
    if (rangeIRI.startsWith(XSD_PREFIX)) {
        const local = rangeIRI.slice(XSD_PREFIX.length);
        return XSD_TO_TS[local] ?? "string";
    }
    // For object properties that reference another class, use the local name
    const hash = rangeIRI.lastIndexOf("#");
    const slash = rangeIRI.lastIndexOf("/");
    const colon = rangeIRI.lastIndexOf(":");
    return rangeIRI.slice(Math.max(hash, slash, colon) + 1);
}

function iriConstName(localName: string): string {
    return `${localName}IRI`;
}

function renderProperty(prop: OntologyProperty): string {
    const tsType = prop.kind === "data" ? xsdToTs(prop.range) : xsdToTs(prop.range);
    const comment = prop.comment ? `    /** ${prop.comment} */\n` : "";
    return `${comment}    ${prop.name}?: ${tsType};`;
}

function renderClass(cls: OntologyClass): string {
    const comment = cls.comment ? `/** ${cls.comment} */\n` : "";
    const props = cls.properties.map(renderProperty).join("\n");
    return `${comment}export interface ${cls.name} {\n${props}\n}`;
}

function renderIRIConstant(iri: string, name: string): string {
    return `export const ${iriConstName(name)} = new IRI('${iri}');`;
}

// ── SHACL-aware property renderer ────────────────────────────────────────────

export interface AugmentedGenConfig {
    /** Maps class IRI → npm import path for classes defined outside this ontology. */
    externalClasses: Map<string, string>;
    /** IRI prefix that identifies all local (extension) classes and properties. */
    localNamespace: string;
    /**
     * Import path for the IRI class.  Defaults to `'@system/core'`.
     * Override when generating types inside @system/core itself.
     */
    iriImport?: string;
}

function shaclMinCount(propIri: string, classIri: string, shapes: ShaclShapes): number {
    const ps = shapes.byTargetClass.get(classIri)?.properties.find((p) => p.path === propIri);
    return ps?.minCount ?? 0;
}

function shaclMaxCount(propIri: string, classIri: string, shapes: ShaclShapes): number | undefined {
    return shapes.byTargetClass.get(classIri)?.properties.find((p) => p.path === propIri)?.maxCount;
}

function renderPropertyAugmented(
    prop: OntologyProperty,
    classIri: string,
    shapes: ShaclShapes,
    indent: string,
): string {
    const tsType = xsdToTs(prop.range);
    const required = shaclMinCount(prop.iri, classIri, shapes) >= 1;
    // Object properties are multi-valued unless SHACL constrains maxCount to 1
    const isArray = prop.kind === "object" && shaclMaxCount(prop.iri, classIri, shapes) !== 1;
    const optional = required ? "" : "?";
    const suffix = isArray ? "[]" : "";
    const lines: string[] = [];
    if (prop.comment) {
        lines.push(`${indent}/** ${prop.comment} */`);
    }
    lines.push(`${indent}${prop.name}${optional}: ${tsType}${suffix};`);
    return lines.join("\n");
}

/**
 * Generates a TypeScript source file from a merged (base + extension) ontology.
 *
 * Local classes  → exported interfaces with SHACL-constrained required/array fields.
 * External classes → TypeScript module augmentation blocks (`declare module '...'`)
 *                    containing only properties whose IRI is in the local namespace.
 *
 * This is the codegen entry-point for downstream repos extending core entities.
 */
export function generateAugmentedTypes(
    ontology: Ontology,
    shapes: ShaclShapes,
    config: AugmentedGenConfig,
): string {
    const { externalClasses, localNamespace } = config;

    const iriPkg = config.iriImport ?? "@system/core";

    const lines: string[] = [
        `// auto-generated — do not edit by hand`,
        `import { IRI } from '${iriPkg}';`,
    ];

    // Collect imports from external packages (types used as property ranges)
    const importsByPkg = new Map<string, Set<string>>();
    for (const cls of ontology.classes.values()) {
        const pkg = externalClasses.get(cls.iri);
        if (pkg) {
            if (!importsByPkg.has(pkg)) {
                importsByPkg.set(pkg, new Set());
            }
            importsByPkg.get(pkg)?.add(cls.name);
        }
    }
    for (const [pkg, names] of importsByPkg) {
        lines.push(`import type { ${[...names].sort().join(", ")} } from '${pkg}';`);
    }
    lines.push("");

    // ── Local classes → exported interfaces ──────────────────────────────────
    const localClasses = [...ontology.classes.values()].filter((cls) =>
        cls.iri.startsWith(localNamespace),
    );

    for (const cls of localClasses) {
        if (cls.comment) {
            lines.push(`/** ${cls.comment} */`);
        }
        lines.push(`export interface ${cls.name} {`);
        for (const prop of cls.properties) {
            lines.push(renderPropertyAugmented(prop, cls.iri, shapes, "    "));
        }
        lines.push(`}`);
        lines.push("");
        lines.push(`export const ${cls.name}IRI = new IRI('${cls.iri}');`);
        lines.push("");
    }

    // ── External classes → module augmentation blocks ─────────────────────────
    const externalClassList = [...ontology.classes.values()].filter(
        (cls) => !cls.iri.startsWith(localNamespace),
    );

    for (const cls of externalClassList) {
        const pkg = externalClasses.get(cls.iri);
        if (!pkg) {
            continue;
        }
        // Only augment with properties that belong to the local namespace
        const extProps = cls.properties.filter((p) => p.iri.startsWith(localNamespace));
        if (extProps.length === 0) {
            continue;
        }

        lines.push(`declare module '${pkg}' {`);
        lines.push(`    interface ${cls.name} {`);
        for (const prop of extProps) {
            lines.push(renderPropertyAugmented(prop, cls.iri, shapes, "        "));
        }
        lines.push(`    }`);
        lines.push(`}`);
        lines.push("");
    }

    // ── IRI constants for local properties ────────────────────────────────────
    const localProps = [...ontology.properties.values()].filter((p) =>
        p.iri.startsWith(localNamespace),
    );
    for (const prop of localProps) {
        lines.push(`export const ${iriConstName(prop.name)} = new IRI('${prop.iri}');`);
    }

    return `${lines.join("\n")}\n`;
}

/**
 * Generates a TypeScript source file from an ontology.
 * The file is self-contained and can be imported anywhere @system/core is available.
 */
export function generateTypes(ontology: Ontology, sourceFile: string): string {
    const lines: string[] = [
        `// auto-generated from ${sourceFile} — do not edit by hand`,
        `import { IRI } from '@jasonscharf/core';`,
        "",
    ];

    for (const cls of ontology.classes.values()) {
        lines.push(renderClass(cls));
        lines.push("");
        lines.push(renderIRIConstant(cls.iri, cls.name));
        lines.push("");
    }

    for (const prop of ontology.properties.values()) {
        lines.push(renderIRIConstant(prop.iri, prop.name));
    }

    return lines.join("\n");
}
