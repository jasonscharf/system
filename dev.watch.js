/**
 * This script reloads containers when relevant changes are detected.
 * This is as opposed to having in-container tooling perform these duties.
 *
 * RDF hot-reload pipeline:
 *   *.nt / *.ttl change → gen → *.generated.ts → tsc → dist change → container restart
 */

import { exec, spawn } from "node:child_process";
import chokidar from "chokidar";

let restarting = false;

export function restartRoles() {
    if (restarting) {
        return;
    }

    restarting = true;

    console.log(`♻️ Restarting roles...`);

    exec("yarn compose restart worker api", (err, stdout, stderr) => {
        if (err) {
            console.log(`Error: ${err}`);
        }

        console.log(stdout, stderr);
        restarting = false;
    });
}

// Note: Role 'test' uses vitest's watch implementation at the moment
const watcher = chokidar.watch(
    ["packages/api/dist", "packages/backend/dist", "packages/core/dist", "packages/worker/dist"],
    {
        ignoreInitial: true,
    },
);

watcher.on("all", (event, path) => {
    const match = path.match(/^packages\/([^/]+)\//);

    const packageName = match && match.length > 0 ? match[1] : "(unknown)";
    console.log(`🔄 ${event}: ${path} in package ${packageName}`);

    restartRoles();
});

// RDF → TypeScript gen watcher
// When any N-Triples / Turtle file changes, regenerate its .generated.ts counterpart.
// tsc -b -w (run separately via `yarn watch`) picks up the new .ts and emits to dist.
const rdfWatcher = chokidar.watch(["packages/**/src/**/*.nt", "packages/**/src/**/*.ttl"], {
    ignoreInitial: false,
    ignored: /node_modules|dist/,
});

rdfWatcher.on("add", runCodegen);
rdfWatcher.on("change", runCodegen);

function runCodegen(filePath) {
    console.log(`[gen] ${filePath}`);
    const proc = spawn("yarn", ["type-gen", filePath], { stdio: "inherit" });
    proc.on("exit", (code) => {
        if (code !== 0) {
            console.error(`[gen] Failed for ${filePath} (exit ${code})`);
        }
    });
}
