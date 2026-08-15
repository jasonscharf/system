#!/usr/bin/env node
/* c8 ignore file */
/**
 * Tern codegen CLI
 *
 * Zero-config usage (recommended):
 *   tern-codegen             # read the `tern` manifest in package.json, generate once
 *   tern-codegen --watch     # same, re-running on any ontology or manifest change
 *
 * The manifest drives every codegen target the package declares, so a package
 * owning four bounded contexts regenerates them all with one command.  Watch mode
 * watches every ontology reachable from the manifest — previously it auto-discovered
 * a single `tern-gen.json` and silently ignored a package's other ontologies.
 *
 * Explicit config (legacy sidecar, still supported for ad-hoc configs):
 *   tern-codegen --config <config.json>
 *   tern-codegen --config <config.json> --watch
 *
 * Single-file (legacy):
 *   tern-codegen <file.ttl>
 *   tern-codegen --watch <glob>
 *
 * Downstream packages just need this in package.json:
 *   "scripts": { "gen": "tern-codegen", "gen:watch": "tern-codegen --watch" }
 */
import path from "node:path";
import { generate, generateFromConfig } from "./generate.js";
import { findManifest, generateFromManifest, manifestInputs, readManifest } from "./manifest.js";

const [, , ...args] = process.argv;

// ── Flag parsing ──────────────────────────────────────────────────────────────

const watchIdx = args.indexOf("--watch");
const configIdx = args.indexOf("--config");
const watchMode = watchIdx !== -1;

const cleanArgs = args.filter((_, i) => i !== watchIdx);

// ── Mode dispatch ─────────────────────────────────────────────────────────────

if (configIdx !== -1) {
    // Explicit --config <file>
    const configPath = args[configIdx + 1];
    if (!configPath) {
        console.error("Usage: tern-codegen --config <tern-gen.json> [--watch]");
        process.exit(1);
    }
    await runConfig(path.resolve(configPath), watchMode);
} else if (cleanArgs.length === 0) {
    // Zero-arg: discover the `tern` manifest in package.json
    const packageJsonPath = await findManifest(process.cwd());
    if (!packageJsonPath) {
        console.error(
            '[gen] No package.json with a "tern" manifest found in this directory or any parent.\n' +
                '      Add a "tern" field to package.json (see packages/core/package.json),\n' +
                "      or run: tern-codegen --config <path>",
        );
        process.exit(1);
    }
    console.log(`[gen] Using ${path.relative(process.cwd(), packageJsonPath)}`);
    await runManifest(packageJsonPath, watchMode);
} else {
    // Legacy single-file mode
    if (watchMode) {
        const targets = cleanArgs;
        if (targets.length === 0) {
            console.error("Usage: tern-codegen --watch <glob> [glob ...]");
            process.exit(1);
        }
        const { default: chokidar } = await import("chokidar");
        const watcher = chokidar.watch(targets, { ignoreInitial: false });
        watcher.on("add", generate);
        watcher.on("change", generate);
        console.log(`[gen] Watching ${targets.join(", ")} ...`);
    } else {
        for (const t of cleanArgs) {
            await generate(t);
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function runConfig(configPath: string, watch: boolean): Promise<void> {
    if (!watch) {
        await generateFromConfig(configPath);
        return;
    }

    // Watch mode: re-run on any file listed in the config
    const { readFile } = await import("node:fs/promises");
    const config = JSON.parse(await readFile(configPath, "utf-8"));
    const dir = path.dirname(configPath);

    const watchTargets = [
        configPath,
        ...(config.bases ?? []).map((b: { ontology: string }) => path.resolve(dir, b.ontology)),
        ...(config.extensions ?? []).map((f: string) => path.resolve(dir, f)),
        ...(config.shapes ?? []).map((f: string) => path.resolve(dir, f)),
    ];

    const { default: chokidar } = await import("chokidar");
    const run = () => generateFromConfig(configPath).catch(console.error);

    const watcher = chokidar.watch(watchTargets, { ignoreInitial: false });
    watcher.on("add", run);
    watcher.on("change", run);
    console.log(
        `[gen] Watching ${watchTargets.map((t) => path.relative(process.cwd(), t)).join(", ")} ...`,
    );
}

/**
 * Runs a package's `tern` manifest, optionally re-running whenever any ontology,
 * shapes file, or the manifest itself changes.
 */
async function runManifest(packageJsonPath: string, watch: boolean): Promise<void> {
    if (!watch) {
        await generateFromManifest(packageJsonPath);
        return;
    }

    const loaded = await readManifest(packageJsonPath);
    if (loaded === null) {
        console.error(`[gen] ${packageJsonPath} declares no "tern" manifest.`);
        process.exit(1);
    }

    // Watch every input the manifest reaches, so a package with several bounded
    // contexts re-generates all of them on any ontology change.
    const watchTargets = manifestInputs(loaded);
    const { default: chokidar } = await import("chokidar");
    const run = () => generateFromManifest(packageJsonPath).catch(console.error);

    const watcher = chokidar.watch(watchTargets, { ignoreInitial: false });
    watcher.on("add", run);
    watcher.on("change", run);
    console.log(
        `[gen] Watching ${watchTargets.map((t) => path.relative(process.cwd(), t)).join(", ")} ...`,
    );
}
