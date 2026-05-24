#!/usr/bin/env node
import { execFileSync } from "node:child_process";
/**
 * Runs `tern-codegen` for every workspace package that has a tern-gen.json.
 * Invoked via `yarn gen` from the repo root.
 */
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pkgsDir = resolve(root, "packages");
const bin = resolve(root, "packages/gen/dist/bin.js");

const packages = readdirSync(pkgsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

let ran = 0;
for (const pkg of packages) {
    const configPath = resolve(pkgsDir, pkg, "tern-gen.json");
    if (!existsSync(configPath)) {
        continue;
    }
    console.log(`\n[gen] → ${pkg}`);
    execFileSync("node", [bin, "--config", configPath], {
        stdio: "inherit",
        cwd: resolve(pkgsDir, pkg),
    });
    ran++;
}

if (ran === 0) {
    console.log("[gen] No tern-gen.json found in any package.");
}
