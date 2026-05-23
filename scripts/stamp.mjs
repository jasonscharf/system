#!/usr/bin/env node
/**
 * Stamps every workspace package with a version.json containing:
 *   name, version (from package.json), branch, sha, shaFull, timestamp
 *
 * Run manually: node scripts/stamp.mjs
 * Hooked into:  yarn build (runs first, before tsc)
 *
 * In CI the branch is read from GITHUB_HEAD_REF / GITHUB_REF_NAME so it
 * works correctly in both PR and push contexts, including detached HEADs.
 */
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

function git(cmd) {
    try {
        return execSync(cmd, {
            cwd: root,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
    } catch {
        return "";
    }
}

const shaFull = git("git rev-parse HEAD") || "unknown";
const sha =
    git("git rev-parse --short HEAD") || (shaFull !== "unknown" ? shaFull.slice(0, 8) : "unknown");
const branch =
    process.env.GITHUB_HEAD_REF || // PR source branch
    process.env.GITHUB_REF_NAME || // push / tag ref name
    git("git branch --show-current") || // local git
    git("git rev-parse --abbrev-ref HEAD") || // detached fallback
    "unknown";
const timestamp = new Date().toISOString();

const pkgsDir = join(root, "packages");
const entries = readdirSync(pkgsDir, { withFileTypes: true });

for (const entry of entries) {
    if (!entry.isDirectory()) {
        continue;
    }

    const pkgJsonPath = join(pkgsDir, entry.name, "package.json");
    let pkgJson;
    try {
        pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
    } catch {
        continue;
    }

    const stamp = {
        name: pkgJson.name ?? entry.name,
        version: pkgJson.version ?? "0.0.0",
        branch,
        sha,
        shaFull,
        timestamp,
    };

    const outPath = join(pkgsDir, entry.name, "version.json");
    writeFileSync(outPath, `${JSON.stringify(stamp, null, 2)}\n`);
    console.log(`[stamp] ${stamp.name}@${stamp.version}  ${sha} @ ${branch}`);
}
