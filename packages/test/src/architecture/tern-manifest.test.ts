/**
 * Architecture gate — every ontology-owning package declares a `tern` manifest (TRN-623).
 *
 * The manifest is the binding contract that makes a package an extension.  Before
 * it existed, codegen configuration lived in sidecar `tern-gen*.json` files that
 * nothing linked back to the package: the build could not enumerate extensions,
 * and neither could a marketplace.  A sidecar was easy to orphan — `superuser.ttl`
 * had no config at all, and `@jasonscharf/server` shipped a `tern-gen-rbac.json`
 * that no script ever ran.
 *
 * This gate locks that in from both directions:
 *   - every package with an `ontology/` directory carries a `tern` manifest, and
 *   - no sidecar `tern-gen*.json` may come back.
 *
 * It also checks the manifest is internally coherent (every referenced `.ttl`
 * exists, every target names an output), so an orphaned ontology fails the build
 * rather than silently generating nothing.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Repo root: this file lives at packages/test/src/architecture/<file>, so the
// workspace root is four directories up.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../..");
const PACKAGES_DIR = path.join(REPO_ROOT, "packages");

interface GenTarget {
    readonly name?: string;
    readonly extensions?: string[];
    readonly bases?: Array<{ ontology: string }>;
    readonly shapes?: string[];
    readonly out?: string;
    readonly shapesOut?: string;
    readonly schemasOut?: string;
}

interface TernManifest extends GenTarget {
    readonly extension?: string;
    readonly requires?: string[];
    readonly targets?: GenTarget[];
}

function packageDirs(): string[] {
    return readdirSync(PACKAGES_DIR).filter((entry) => {
        const full = path.join(PACKAGES_DIR, entry);
        try {
            return statSync(full).isDirectory() && existsSync(path.join(full, "package.json"));
        } catch {
            return false;
        }
    });
}

function manifestOf(pkg: string): TernManifest | null {
    const pkgJson = path.join(PACKAGES_DIR, pkg, "package.json");
    const parsed = JSON.parse(readFileSync(pkgJson, "utf8")) as { tern?: TernManifest };
    return parsed.tern ?? null;
}

/** Normalises a manifest to its list of codegen targets (inline single-target shorthand allowed). */
function targetsOf(manifest: TernManifest): GenTarget[] {
    if (manifest.targets && manifest.targets.length > 0) {
        return manifest.targets;
    }
    return [manifest];
}

function ownsOntology(pkg: string): boolean {
    const dir = path.join(PACKAGES_DIR, pkg, "ontology");
    try {
        return statSync(dir).isDirectory();
    } catch {
        return false;
    }
}

describe("architecture: tern manifest is the extension contract (TRN-623)", () => {
    it("every package with an ontology/ directory declares a tern manifest", () => {
        const missing = packageDirs()
            .filter(ownsOntology)
            .filter((pkg) => manifestOf(pkg) === null);

        const message = [
            "These packages own an ontology/ directory but declare no `tern` manifest",
            "in package.json.  Codegen cannot find their ontologies and the build cannot",
            "enumerate them as extensions:",
            ...missing.map((m) => `  - packages/${m}`),
            "",
            'Add a "tern" field to the package.json — see packages/core/package.json.',
        ].join("\n");

        expect(missing, message).toEqual([]);
    });

    it("no sidecar tern-gen*.json config files remain", () => {
        const strays: string[] = [];
        for (const pkg of packageDirs()) {
            const dir = path.join(PACKAGES_DIR, pkg);
            for (const entry of readdirSync(dir)) {
                if (/^tern-gen.*\.json$/.test(entry)) {
                    strays.push(`packages/${pkg}/${entry}`);
                }
            }
        }

        const message = [
            "Sidecar codegen configs are superseded by the `tern` manifest in package.json.",
            "These files must be folded into their package's manifest and deleted:",
            ...strays.map((s) => `  - ${s}`),
        ].join("\n");

        expect(strays, message).toEqual([]);
    });

    it("every manifest declares an extension IRI", () => {
        const bad: string[] = [];
        for (const pkg of packageDirs()) {
            const manifest = manifestOf(pkg);
            if (manifest === null) {
                continue;
            }
            if (typeof manifest.extension !== "string" || manifest.extension.length === 0) {
                bad.push(`packages/${pkg} (missing "extension")`);
                continue;
            }
            if (!manifest.extension.startsWith("urn:")) {
                bad.push(`packages/${pkg} ("extension" is not a urn: IRI — ${manifest.extension})`);
            }
        }

        const message = [
            "Every `tern` manifest must identify its extension with a urn: IRI:",
            ...bad.map((b) => `  - ${b}`),
        ].join("\n");

        expect(bad, message).toEqual([]);
    });

    it("every ontology and shapes file referenced by a manifest exists", () => {
        const missing: string[] = [];
        for (const pkg of packageDirs()) {
            const manifest = manifestOf(pkg);
            if (manifest === null) {
                continue;
            }
            const pkgDir = path.join(PACKAGES_DIR, pkg);
            for (const target of targetsOf(manifest)) {
                const refs = [
                    ...(target.extensions ?? []),
                    ...(target.shapes ?? []),
                    ...(target.bases ?? []).map((b) => b.ontology),
                ];
                for (const ref of refs) {
                    if (!existsSync(path.resolve(pkgDir, ref))) {
                        missing.push(`packages/${pkg}: ${ref}`);
                    }
                }
            }
        }

        const message = [
            "These manifest entries reference ontology/shapes files that do not exist:",
            ...missing.map((m) => `  - ${m}`),
        ].join("\n");

        expect(missing, message).toEqual([]);
    });

    it("every manifest target produces at least one output", () => {
        const inert: string[] = [];
        for (const pkg of packageDirs()) {
            const manifest = manifestOf(pkg);
            if (manifest === null) {
                continue;
            }
            for (const target of targetsOf(manifest)) {
                if (!target.out && !target.shapesOut && !target.schemasOut) {
                    inert.push(`packages/${pkg}: target "${target.name ?? "(unnamed)"}"`);
                }
            }
        }

        const message = [
            "These codegen targets declare no output (out / shapesOut / schemasOut),",
            "so they parse an ontology and emit nothing:",
            ...inert.map((i) => `  - ${i}`),
        ].join("\n");

        expect(inert, message).toEqual([]);
    });

    it("no .ttl ontology is orphaned — every one is referenced by a manifest", () => {
        const orphans: string[] = [];
        for (const pkg of packageDirs()) {
            if (!ownsOntology(pkg)) {
                continue;
            }
            const pkgDir = path.join(PACKAGES_DIR, pkg);
            const ontologyDir = path.join(pkgDir, "ontology");
            const manifest = manifestOf(pkg);

            // Files any manifest in the workspace references, resolved absolute.
            const referenced = new Set<string>();
            for (const other of packageDirs()) {
                const otherManifest = manifestOf(other);
                if (otherManifest === null) {
                    continue;
                }
                const otherDir = path.join(PACKAGES_DIR, other);
                for (const target of targetsOf(otherManifest)) {
                    for (const ref of [
                        ...(target.extensions ?? []),
                        ...(target.shapes ?? []),
                        ...(target.bases ?? []).map((b) => b.ontology),
                    ]) {
                        referenced.add(path.resolve(otherDir, ref));
                    }
                }
            }

            for (const entry of readdirSync(ontologyDir)) {
                if (!entry.endsWith(".ttl")) {
                    continue;
                }
                const full = path.join(ontologyDir, entry);
                if (!referenced.has(full)) {
                    orphans.push(`packages/${pkg}/ontology/${entry}`);
                }
            }
            void manifest;
        }

        const message = [
            "These ontologies are not referenced by any `tern` manifest, so codegen",
            "never reads them — they are dead RDF:",
            ...orphans.map((o) => `  - ${o}`),
            "",
            "Either add a codegen target for the ontology or delete it.",
        ].join("\n");

        expect(orphans, message).toEqual([]);
    });
});
