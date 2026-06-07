import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { Triple } from "@jasonscharf/core";
import { generateTypes, parseNTriples, readOntology } from "./index.js";
import { generateSchemas } from "./SchemaGenerator.js";
import type { ShaclShapes } from "./ShaclReader.js";
import { mergeShapes, readShaclShapes } from "./ShaclReader.js";
import { generateShapesDescriptor } from "./ShapeGenerator.js";
import { parseTurtle } from "./TurtleParser.js";
import type { AugmentedGenConfig } from "./TypeGenerator.js";
import { generateAugmentedTypes } from "./TypeGenerator.js";

export interface BaseOntologyConfig {
    /** Path to the base .nt ontology file, relative to the config file. */
    ontology: string;
    /** npm package name used when marking classes as external. */
    package: string;
    /**
     * TypeScript import path for the package (defaults to `package`).
     * Override when the published name differs (e.g. scoped packages).
     */
    importPath?: string;
}

export interface GenConfig {
    /** Base ontologies whose classes are treated as external (not re-generated). */
    bases: BaseOntologyConfig[];
    /** Extension ontology files that add new classes/properties, relative to the config. */
    extensions: string[];
    /** SHACL shapes files, relative to the config. Used to derive required/array types. */
    shapes?: string[];
    /** IRI prefix that identifies all classes and properties defined in this extension. */
    localNamespace: string;
    /** Output path for the generated TypeScript types file, relative to the config.  Omit to skip type generation. */
    out?: string;
    /** Optional output path for the generated runtime shapes descriptor. */
    shapesOut?: string;
    /** Optional output path for generated EntitySchema constants (properties + edges). */
    schemasOut?: string;
    /** Import path for EntitySchema in the generated schemas file.  Defaults to `@jasonscharf/entities`. */
    entitiesImport?: string;
    /** Absolute named-graph IRI to pin every generated schema to (global-backbone ontologies like RBAC). */
    schemaGraphIri?: string;
    /** Per-class IRI path-segment overrides for generated schemas (class local name → segment). */
    idSegments?: Record<string, string>;
    /**
     * Import path for the `IRI` class.  Defaults to `"@jasonscharf/core"`.
     * Override to `"../semantics/IRI.js"` when generating types inside @jasonscharf/core itself.
     */
    iriImport?: string;
}

// ── Output formatting ─────────────────────────────────────────────────────────
// Generated files are committed to source control, so they must match the repo's
// formatting conventions (quote style, import order, line width).  Rather than
// teach every generator biome's exact output, we run biome over each written file.
// Codegen is the source of truth; the formatter just normalises its emission.

const _require = createRequire(import.meta.url);
let _biomeBin: string | null | undefined;

function biomeBin(): string | null {
    if (_biomeBin === undefined) {
        try {
            _biomeBin = _require.resolve("@biomejs/biome/bin/biome");
        } catch {
            // biome not installed (e.g. standalone tern-codegen usage) — skip formatting.
            _biomeBin = null;
        }
    }
    return _biomeBin;
}

/**
 * Formats a freshly written generated file with biome (format + organize imports),
 * so codegen output matches the surrounding codebase.  No-op when biome is absent.
 */
function formatGenerated(filePath: string): void {
    const bin = biomeBin();
    if (bin === null) {
        return;
    }
    // Formatter + assists (organize imports) only.  The linter stays off so biome never
    // rewrites the generated shape (e.g. collapsing an empty `interface` into a `type`).
    spawnSync(process.execPath, [bin, "check", "--write", "--linter-enabled=false", filePath], {
        stdio: "ignore",
    });
}

function parserFor(filePath: string) {
    return /\.(ttl|n3)$/i.test(filePath) ? parseTurtle : parseNTriples;
}

async function parseFile(filePath: string): Promise<Triple[]> {
    const content = await readFile(filePath, "utf-8");
    const triples: Triple[] = [];
    for await (const t of parserFor(filePath)(content)) {
        triples.push(t);
    }
    return triples;
}

/**
 * Reads a tern-gen.json config file and generates:
 *   - A merged TypeScript types file (local classes + module augmentations for base classes)
 *   - Optionally a runtime shapes descriptor for use with ShaclValidator
 *
 * The merged ontology is built by concatenating all base + extension triples so that
 * cross-namespace domain/range links (e.g. analytics properties on auth:User) resolve
 * correctly in a single readOntology pass.
 */
export async function generateFromConfig(configPath: string): Promise<void> {
    const dir = path.dirname(path.resolve(configPath));
    const config = JSON.parse(await readFile(configPath, "utf-8")) as GenConfig;

    const externalClasses = new Map<string, string>(); // classIRI → importPath
    // classIRI → the EntitySchema to import when an edge targets a base class.
    const schemaImports = new Map<string, { importPath: string; schemaName: string }>();
    const allTriples: Triple[] = [];
    let allShapes: ShaclShapes = { nodeShapes: new Map(), byTargetClass: new Map() };

    // Parse each base ontology; record its classes as external
    for (const base of config.bases ?? []) {
        const triples = await parseFile(path.resolve(dir, base.ontology));
        for (const t of triples) {
            allTriples.push(t);
        }
        const importPath = base.importPath ?? base.package;
        for (const cls of readOntology(triples).classes.values()) {
            externalClasses.set(cls.iri, importPath);
            schemaImports.set(cls.iri, { importPath, schemaName: `${cls.name}Schema` });
        }
    }

    // Parse extension ontologies
    for (const extFile of config.extensions ?? []) {
        const triples = await parseFile(path.resolve(dir, extFile));
        for (const t of triples) {
            allTriples.push(t);
        }
    }

    // Parse SHACL shapes
    for (const shapeFile of config.shapes ?? []) {
        const triples = await parseFile(path.resolve(dir, shapeFile));
        allShapes = mergeShapes(allShapes, readShaclShapes(triples));
    }

    // Single readOntology pass over all triples so cross-namespace domain links resolve
    const merged = readOntology(allTriples);

    const augConfig: AugmentedGenConfig = {
        externalClasses,
        localNamespace: config.localNamespace,
        iriImport: config.iriImport,
    };
    if (config.out) {
        const typesSource = generateAugmentedTypes(merged, allShapes, augConfig);
        const outPath = path.resolve(dir, config.out);
        await mkdir(path.dirname(outPath), { recursive: true });
        await writeFile(outPath, typesSource, "utf-8");
        formatGenerated(outPath);
        console.log(`[gen] merged types → ${path.relative(process.cwd(), outPath)}`);
    }

    if (config.shapesOut) {
        const shapesSource = generateShapesDescriptor(allShapes);
        const shapesPath = path.resolve(dir, config.shapesOut);
        await mkdir(path.dirname(shapesPath), { recursive: true });
        await writeFile(shapesPath, shapesSource, "utf-8");
        formatGenerated(shapesPath);
        console.log(`[gen] shapes descriptor → ${path.relative(process.cwd(), shapesPath)}`);
    }

    if (config.schemasOut) {
        const schemasSource = generateSchemas(merged, allShapes, {
            localNamespace: config.localNamespace,
            entitiesImport: config.entitiesImport,
            iriImport: config.iriImport,
            graphIri: config.schemaGraphIri,
            idSegments: config.idSegments,
            schemaImports,
        });
        const schemasPath = path.resolve(dir, config.schemasOut);
        await mkdir(path.dirname(schemasPath), { recursive: true });
        await writeFile(schemasPath, schemasSource, "utf-8");
        formatGenerated(schemasPath);
        console.log(`[gen] entity schemas → ${path.relative(process.cwd(), schemasPath)}`);
    }
}

/**
 * Reads an RDF file, generates TypeScript types, and writes a sibling `.generated.ts` file.
 * The output path is derived by replacing the RDF extension with `.generated.ts`.
 */
export async function generate(inputPath: string): Promise<void> {
    const triples = await parseFile(inputPath);
    const ontology = readOntology(triples);
    const source = generateTypes(ontology, path.basename(inputPath));

    const outPath = inputPath.replace(/\.(nt|n3|ttl|rdf)$/, ".generated.ts");
    await writeFile(outPath, source, "utf-8");
    formatGenerated(outPath);
    console.log(`[gen] ${path.basename(inputPath)} → ${path.basename(outPath)}`);
}
