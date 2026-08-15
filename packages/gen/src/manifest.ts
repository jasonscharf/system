/**
 * The `tern` package manifest — the binding contract that makes a package an extension.
 *
 * Codegen configuration used to live in sidecar `tern-gen*.json` files that nothing
 * linked back to the package.  The build could not enumerate extensions, sidecars
 * were easy to orphan, and a package with four bounded contexts needed four config
 * files plus a hand-chained `gen` script to drive them.
 *
 * The manifest replaces all of that.  It lives in `package.json` under `tern`:
 *
 *     "tern": {
 *         "extension": "urn:sys:ext:labs",
 *         "requires": ["urn:sys:core"],
 *         "extensions": ["./ontology/labs.ttl"],
 *         "shapes": ["./ontology/labs.shacl.ttl"],
 *         "localNamespace": "urn:sys:ext:labs:",
 *         "out": "./src/labs/types.generated.ts"
 *     }
 *
 * A package that owns several bounded contexts declares them as named `targets`,
 * so one manifest drives every ontology it owns:
 *
 *     "tern": {
 *         "extension": "urn:sys:core",
 *         "targets": [
 *             { "name": "auth", "extensions": ["./ontology/auth.ttl"], ... },
 *             { "name": "rbac", "extensions": ["./ontology/rbac.ttl"], ... }
 *         ]
 *     }
 *
 * Paths inside a target resolve relative to the package directory (the directory
 * holding `package.json`), not to a config file.
 */

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateExtensionDescriptor } from "./ExtensionGenerator.js";
import type { GenConfig } from "./generate.js";
import { formatGenerated, generateTarget } from "./generate.js";

/**
 * One codegen target: an ontology (plus optional bases/shapes) and the files it emits.
 * Structurally a `GenConfig` with an optional name for diagnostics.
 */
export interface GenTarget extends GenConfig {
    /** Human-readable name used in log output, e.g. "auth".  Optional but recommended. */
    name?: string;
}

/**
 * The `tern` field of a package.json.
 *
 * Extends `GenTarget` so a single-ontology package can declare its codegen inline
 * rather than wrapping one entry in a `targets` array.
 */
export interface TernManifest extends Partial<GenTarget> {
    /** IRI identifying this package as an extension, e.g. "urn:sys:ext:labs". */
    extension: string;
    /** Extension IRIs that must be installed before this one. */
    requires?: string[];
    /** Codegen targets.  Omit to use the manifest itself as a single inline target. */
    targets?: GenTarget[];
    /** Output path for the generated extension descriptor, relative to the package dir. */
    extensionOut?: string;
}

/** A manifest paired with the package that declares it. */
export interface LoadedManifest {
    /** Absolute path to the package directory (the one holding package.json). */
    readonly dir: string;
    /** The package's npm name. */
    readonly packageName: string;
    /** The package's version, used as the extension version. */
    readonly version: string | undefined;
    readonly manifest: TernManifest;
}

/**
 * Reads the `tern` manifest from a package.json.
 * Returns null when the file declares no manifest.
 */
export async function readManifest(packageJsonPath: string): Promise<LoadedManifest | null> {
    const raw = await readFile(packageJsonPath, "utf-8");
    const parsed = JSON.parse(raw) as {
        name?: string;
        version?: string;
        tern?: TernManifest;
    };
    if (!parsed.tern) {
        return null;
    }
    if (typeof parsed.tern.extension !== "string" || parsed.tern.extension.length === 0) {
        throw new Error(
            `[gen] ${packageJsonPath}: "tern.extension" is required and must be a non-empty IRI.`,
        );
    }
    return {
        dir: path.dirname(path.resolve(packageJsonPath)),
        packageName: parsed.name ?? path.basename(path.dirname(packageJsonPath)),
        version: parsed.version,
        manifest: parsed.tern,
    };
}

/**
 * Normalises a manifest to its list of codegen targets.
 *
 * When `targets` is absent the manifest itself is the target, which keeps the
 * common single-ontology case free of nesting.  Manifest-level keys that are not
 * part of a target (`extension`, `requires`, `targets`, `extensionOut`) are
 * dropped so they never leak into generation.
 */
export function manifestTargets(manifest: TernManifest): GenTarget[] {
    if (manifest.targets && manifest.targets.length > 0) {
        return manifest.targets;
    }
    const { extension, requires, targets, extensionOut, ...inline } = manifest;
    void extension;
    void requires;
    void targets;
    void extensionOut;
    // An inline manifest with no ontology is identity-only (declares the extension
    // but generates nothing) — legitimate for packages that own no RDF.
    if (!inline.extensions && !inline.bases && !inline.out) {
        return [];
    }
    return [inline as GenTarget];
}

/**
 * Walks up from `startDir` looking for a package.json that declares a `tern` manifest.
 * Returns the path to that package.json, or null if none is found.
 */
export async function findManifest(startDir: string): Promise<string | null> {
    let dir = path.resolve(startDir);
    for (;;) {
        const candidate = path.join(dir, "package.json");
        try {
            await access(candidate);
            const raw = await readFile(candidate, "utf-8");
            if ((JSON.parse(raw) as { tern?: unknown }).tern) {
                return candidate;
            }
        } catch {
            // Unreadable or absent package.json — keep walking up.
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            return null;
        }
        dir = parent;
    }
}

/**
 * Runs every codegen target declared by a package's manifest, then emits the
 * extension descriptor when the manifest asks for one.
 *
 * This is what `tern-codegen` runs with no arguments: one command regenerates a
 * package's entire surface, however many bounded contexts it owns.
 */
export async function generateFromManifest(packageJsonPath: string): Promise<void> {
    const loaded = await readManifest(packageJsonPath);
    if (loaded === null) {
        throw new Error(`[gen] ${packageJsonPath} declares no "tern" manifest.`);
    }

    const targets = manifestTargets(loaded.manifest);
    for (const target of targets) {
        if (target.name) {
            console.log(`[gen] ${loaded.manifest.extension} → target "${target.name}"`);
        }
        await generateTarget(loaded.dir, target);
    }

    if (loaded.manifest.extensionOut) {
        const source = generateExtensionDescriptor(loaded);
        const outPath = path.resolve(loaded.dir, loaded.manifest.extensionOut);
        await mkdir(path.dirname(outPath), { recursive: true });
        await writeFile(outPath, source, "utf-8");
        formatGenerated(outPath);
        console.log(`[gen] extension descriptor → ${path.relative(process.cwd(), outPath)}`);
    }

    if (targets.length === 0 && !loaded.manifest.extensionOut) {
        console.log(`[gen] ${loaded.manifest.extension}: identity-only manifest, nothing to emit.`);
    }
}

/**
 * Every file a manifest's targets read.  Used by `--watch` so a change to any
 * ontology or shapes file re-runs generation for the whole package.
 */
export function manifestInputs(loaded: LoadedManifest): string[] {
    const inputs: string[] = [path.join(loaded.dir, "package.json")];
    for (const target of manifestTargets(loaded.manifest)) {
        for (const base of target.bases ?? []) {
            inputs.push(path.resolve(loaded.dir, base.ontology));
        }
        for (const ext of target.extensions ?? []) {
            inputs.push(path.resolve(loaded.dir, ext));
        }
        for (const shape of target.shapes ?? []) {
            inputs.push(path.resolve(loaded.dir, shape));
        }
    }
    return inputs;
}
