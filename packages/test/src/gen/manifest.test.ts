/**
 * Manifest-driven codegen (TRN-623).
 *
 * Exercises the real reader and the real generator against real package.json /
 * ontology files written to a temp directory — no mocks, no fixtures baked into
 * the repo.  Each test drives `tern-codegen`'s actual entry points.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    findManifest,
    generateExtensionDescriptor,
    generateFromManifest,
    manifestInputs,
    manifestTargets,
    readManifest,
} from "@jasonscharf/gen";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ONTOLOGY = `
@prefix rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix owl:  <http://www.w3.org/2002/07/owl#> .
@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .
@prefix ex:   <urn:sys:ext:example:> .

ex:Widget a owl:Class ;
    rdfs:comment "A widget." .

ex:label a owl:DatatypeProperty ;
    rdfs:domain ex:Widget ;
    rdfs:range  xsd:string .
`;

describe("tern manifest", () => {
    let dir: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "tern-manifest-"));
        await mkdir(join(dir, "ontology"), { recursive: true });
        await writeFile(join(dir, "ontology", "example.ttl"), ONTOLOGY);
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    async function writeManifest(
        tern: unknown,
        extra: Record<string, unknown> = {},
    ): Promise<string> {
        const pkgPath = join(dir, "package.json");
        await writeFile(
            pkgPath,
            JSON.stringify({ name: "@example/widgets", version: "1.2.3", tern, ...extra }, null, 4),
        );
        return pkgPath;
    }

    /** Reads a manifest that the test knows exists, narrowing away the null case. */
    async function loadManifest(pkgPath: string) {
        const loaded = await readManifest(pkgPath);
        if (loaded === null) {
            throw new Error(`expected a tern manifest at ${pkgPath}`);
        }
        return loaded;
    }

    it("reads the extension identity from package.json", async () => {
        const pkgPath = await writeManifest({ extension: "urn:sys:ext:example" });

        const loaded = await readManifest(pkgPath);

        expect(loaded).not.toBeNull();
        expect(loaded?.manifest.extension).toBe("urn:sys:ext:example");
        expect(loaded?.packageName).toBe("@example/widgets");
        expect(loaded?.version).toBe("1.2.3");
    });

    it("returns null for a package.json with no tern manifest", async () => {
        const pkgPath = join(dir, "package.json");
        await writeFile(pkgPath, JSON.stringify({ name: "plain" }));

        expect(await readManifest(pkgPath)).toBeNull();
    });

    it("rejects a manifest with no extension IRI", async () => {
        const pkgPath = await writeManifest({ requires: [] });

        await expect(readManifest(pkgPath)).rejects.toThrow(/tern.extension/);
    });

    it("treats an inline manifest as a single codegen target", async () => {
        const pkgPath = await writeManifest({
            extension: "urn:sys:ext:example",
            extensions: ["./ontology/example.ttl"],
            localNamespace: "urn:sys:ext:example:",
            out: "./src/types.generated.ts",
        });

        const loaded = await loadManifest(pkgPath);
        const targets = manifestTargets(loaded.manifest);

        expect(targets).toHaveLength(1);
        expect(targets[0].out).toBe("./src/types.generated.ts");
        // Identity keys must not leak into the target passed to the generator.
        expect(targets[0]).not.toHaveProperty("extension");
        expect(targets[0]).not.toHaveProperty("requires");
    });

    it("treats an identity-only manifest as having no targets", async () => {
        const pkgPath = await writeManifest({ extension: "urn:sys:ext:example" });
        const loaded = await loadManifest(pkgPath);

        expect(manifestTargets(loaded.manifest)).toEqual([]);
    });

    it("generates every target a multi-context manifest declares", async () => {
        await writeFile(
            join(dir, "ontology", "other.ttl"),
            ONTOLOGY.replace(/ex:Widget/g, "ex:Gadget").replace(/ex:label/g, "ex:tag"),
        );
        const pkgPath = await writeManifest({
            extension: "urn:sys:ext:example",
            targets: [
                {
                    name: "widgets",
                    extensions: ["./ontology/example.ttl"],
                    localNamespace: "urn:sys:ext:example:",
                    out: "./src/widgets/types.generated.ts",
                },
                {
                    name: "gadgets",
                    extensions: ["./ontology/other.ttl"],
                    localNamespace: "urn:sys:ext:example:",
                    out: "./src/gadgets/types.generated.ts",
                },
            ],
        });

        await generateFromManifest(pkgPath);

        const widgets = await readFile(join(dir, "src/widgets/types.generated.ts"), "utf-8");
        const gadgets = await readFile(join(dir, "src/gadgets/types.generated.ts"), "utf-8");
        expect(widgets).toContain("Widget");
        expect(gadgets).toContain("Gadget");
    });

    it("resolves target paths against the package directory", async () => {
        const pkgPath = await writeManifest({
            extension: "urn:sys:ext:example",
            extensions: ["./ontology/example.ttl"],
            localNamespace: "urn:sys:ext:example:",
            out: "./src/nested/deep/types.generated.ts",
        });

        await generateFromManifest(pkgPath);

        const out = await readFile(join(dir, "src/nested/deep/types.generated.ts"), "utf-8");
        expect(out).toContain("Widget");
    });

    it("emits an extension descriptor carrying identity from the manifest", async () => {
        const pkgPath = await writeManifest({
            extension: "urn:sys:ext:example",
            requires: ["urn:sys:core"],
            extensions: ["./ontology/example.ttl"],
            localNamespace: "urn:sys:ext:example:",
            out: "./src/types.generated.ts",
            extensionOut: "./src/extension.generated.ts",
        });

        await generateFromManifest(pkgPath);

        const src = await readFile(join(dir, "src/extension.generated.ts"), "utf-8");
        expect(src).toContain('EXAMPLE_EXTENSION_IRI = "urn:sys:ext:example"');
        expect(src).toContain('name: "@example/widgets"');
        expect(src).toContain('version: "1.2.3"');
        expect(src).toContain('requires: ["urn:sys:core"]');
        expect(src).toContain('ontologies: ["./ontology/example.ttl"]');
    });

    it("generates a descriptor with an empty requires list when none are declared", async () => {
        const pkgPath = await writeManifest({ extension: "urn:sys:ext:example" });
        const loaded = await loadManifest(pkgPath);

        const src = generateExtensionDescriptor(loaded);

        expect(src).toContain("requires: []");
        expect(src).toContain("ontologies: []");
    });

    it("lists every ontology, shapes and base file as a watch input", async () => {
        await writeFile(join(dir, "ontology", "example.shacl.ttl"), "");
        const pkgPath = await writeManifest({
            extension: "urn:sys:ext:example",
            bases: [{ ontology: "./ontology/example.ttl", package: "@example/base" }],
            extensions: ["./ontology/example.ttl"],
            shapes: ["./ontology/example.shacl.ttl"],
            localNamespace: "urn:sys:ext:example:",
            out: "./src/types.generated.ts",
        });

        const loaded = await loadManifest(pkgPath);
        const inputs = manifestInputs(loaded);

        expect(inputs).toContain(join(dir, "package.json"));
        expect(inputs).toContain(join(dir, "ontology", "example.ttl"));
        expect(inputs).toContain(join(dir, "ontology", "example.shacl.ttl"));
    });

    it("discovers the manifest by walking up from a nested directory", async () => {
        const pkgPath = await writeManifest({ extension: "urn:sys:ext:example" });
        const nested = join(dir, "src", "deep", "nested");
        await mkdir(nested, { recursive: true });

        expect(await findManifest(nested)).toBe(pkgPath);
    });

    it("returns null when no manifest exists above the start directory", async () => {
        const orphan = await mkdtemp(join(tmpdir(), "tern-no-manifest-"));
        try {
            // A package.json with no `tern` field must not satisfy discovery.
            await writeFile(join(orphan, "package.json"), JSON.stringify({ name: "plain" }));
            expect(await findManifest(orphan)).toBeNull();
        } finally {
            await rm(orphan, { recursive: true, force: true });
        }
    });

    it("throws a clear error when asked to generate from a manifest-less package", async () => {
        const pkgPath = join(dir, "package.json");
        await writeFile(pkgPath, JSON.stringify({ name: "plain" }));

        await expect(generateFromManifest(pkgPath)).rejects.toThrow(/declares no "tern" manifest/);
    });
});
