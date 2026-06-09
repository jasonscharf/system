#!/usr/bin/env node
/**
 * version.mjs — compute and stamp publish versions for all packages.
 *
 * Version scheme:  {major}.{minor}.{patch}[-{branch}]
 *
 *   major.minor  —  a git tag on HEAD matching v{M}.{N}[.*] overrides the
 *                   major.minor from package.json.  Push tag v1.2 to main
 *                   to cut a minor release; v2.0 for a major bump.
 *   patch        —  GITHUB_RUN_NUMBER.  Monotonically increasing, unique per
 *                   workflow run — no registry query required, no conflicts.
 *   branch       —  Pre-release suffix appended when the build is triggered
 *                   by any branch other than main.  Tag pushes (
 *                   GITHUB_REF_TYPE=tag) are treated as clean releases and
 *                   receive no suffix regardless of which branch the tag
 *                   points at.  Sanitised to [a-z0-9-].
 *
 * Examples:
 *   main, run 87                  → 0.1.87
 *   tag v1.2, run 88              → 1.2.88
 *   release/1.2 branch, run 89   → 0.1.89-release-1-2
 *
 * Usage:
 *   node scripts/version.mjs
 *
 * Required env:
 *   GITHUB_RUN_NUMBER  — set automatically by GitHub Actions
 *
 * Optional env (set automatically by GitHub Actions):
 *   GITHUB_REF_TYPE    — 'branch' | 'tag'
 *   GITHUB_REF_NAME    — e.g. 'main', 'release/1.2', 'v1.2'
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PACKAGES = [
    "api",
    "app",
    "auth",
    "core",
    "data",
    "entities",
    "flow",
    "gen",
    "server",
    "vaults",
];
const ROOT = new URL("..", import.meta.url).pathname;

// ── Inputs ────────────────────────────────────────────────────────────────────

const runNumber = process.env.GITHUB_RUN_NUMBER;
if (!runNumber) {
    console.error("error: GITHUB_RUN_NUMBER is required");
    process.exit(1);
}

const refType = process.env.GITHUB_REF_TYPE ?? "branch";
const refName = process.env.GITHUB_REF_NAME ?? "";
const isMain = refType === "branch" && refName === "main";
const isTagPush = refType === "tag";

// ── Git tag → major.minor override ───────────────────────────────────────────

function taggedVersion() {
    // On a tag push the ref name IS the tag; also check any tags pointing at HEAD.
    const candidates = [];
    if (isTagPush) {
        candidates.push(refName);
    }
    try {
        const out = execSync("git tag --points-at HEAD", { encoding: "utf8" }).trim();
        candidates.push(
            ...out
                .split("\n")
                .map((t) => t.trim())
                .filter(Boolean),
        );
    } catch {
        /* git unavailable */
    }

    for (const tag of candidates) {
        const m = tag.match(/^v?(\d+)\.(\d+)/);
        if (m) {
            return { major: m[1], minor: m[2] };
        }
    }
    return null;
}

const tagVer = taggedVersion();

// ── Branch suffix ─────────────────────────────────────────────────────────────

function sanitize(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

const suffix = !isMain && !isTagPush ? `-${sanitize(refName)}` : "";

// ── Stamp each package ────────────────────────────────────────────────────────

console.log(
    `run=${runNumber}  ref=${refType}:${refName}  tagVer=${tagVer ? `${tagVer.major}.${tagVer.minor}` : "(none)"}  suffix="${suffix}"`,
);

for (const pkg of PACKAGES) {
    const pkgPath = join(ROOT, "packages", pkg, "package.json");
    const json = JSON.parse(readFileSync(pkgPath, "utf8"));

    const { major, minor } =
        tagVer ??
        (() => {
            const [maj, min] = json.version.split(".");
            return { major: maj, minor: min };
        })();

    json.version = `${major}.${minor}.${runNumber}${suffix}`;
    writeFileSync(pkgPath, `${JSON.stringify(json, null, 2)}\n`);
    console.log(`  ${pkg.padEnd(10)} → ${json.version}`);
}
