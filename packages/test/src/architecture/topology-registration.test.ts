/**
 * Architecture gate — the containment topology is composed, never registered (TRN-627).
 *
 * The authorization scope chain used to be resolved from a process-wide mutable
 * Map that generated schema files populated with an import-time `registerTopology`
 * call. Because the map was only as complete as the set of modules that happened
 * to have been imported, `scopeChainFor` returned a different answer depending on
 * import order, tree-shaking, or the entry point under test — and it narrowed
 * silently, so an ancestor grant simply stopped applying with no error anywhere.
 *
 * A behavioural test can only sample one import order. This gate asserts the
 * structural property that makes every order equivalent: nothing anywhere mutates
 * a shared topology at module scope, and generated files are pure declarations.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// This file lives at packages/test/src/architecture/<file>, so the workspace root
// is four directories up.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../..");
const PACKAGES_DIR = path.join(REPO_ROOT, "packages");

/**
 * Every non-test .ts file under packages/<pkg>/src, excluding build output.
 *
 * `.test.ts` files are skipped: several assert the *absence* of the old symbol by
 * name, and a test that called it would fail to compile anyway now that it is gone.
 */
function sourceFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
        let entries: string[];
        try {
            entries = readdirSync(dir);
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry === "node_modules" || entry === "dist") {
                continue;
            }
            const full = path.join(dir, entry);
            if (statSync(full).isDirectory()) {
                walk(full);
            } else if (
                (entry.endsWith(".ts") || entry.endsWith(".tsx")) &&
                !entry.endsWith(".test.ts") &&
                !entry.endsWith(".test.tsx")
            ) {
                out.push(full);
            }
        }
    };
    for (const pkg of readdirSync(PACKAGES_DIR)) {
        walk(path.join(PACKAGES_DIR, pkg, "src"));
    }
    return out;
}

const rel = (file: string) => path.relative(REPO_ROOT, file);

describe("architecture: containment topology has no import-time global (TRN-627)", () => {
    it("test no source file registers containment topology at import time", () => {
        // The removed API. It must not reappear under its old name, and no
        // re-export shim may keep it alive.
        const offenders = sourceFiles().filter((file) =>
            /\bregisterTopology\b|\bcontainmentPredicates\s*\(\s*\)/.test(
                readFileSync(file, "utf8"),
            ),
        );

        const message = [
            "These files reference the removed import-time topology registry.",
            "The containment topology is composed from schemas and carried on the",
            "ServerContext (ctx.containment) — see buildServerContext:",
            ...offenders.map((f) => `  - ${rel(f)}`),
        ].join("\n");

        expect(offenders.map(rel), message).toEqual([]);
    });

    it("test generated files are pure declarations with no module-scope side effects", () => {
        // Generated code is emitted at column 0, so a top-level statement that is a
        // bare call (rather than an import/export/declaration) sits unindented.
        const offenders: string[] = [];
        for (const file of sourceFiles()) {
            if (!file.includes(".generated.")) {
                continue;
            }
            for (const [index, line] of readFileSync(file, "utf8").split("\n").entries()) {
                // A top-level invocation: `foo(` or `foo.bar(` at column 0.
                if (/^[a-zA-Z_$][\w$]*(\.[\w$]+)*\s*\(/.test(line)) {
                    offenders.push(`${rel(file)}:${index + 1}: ${line.trim()}`);
                }
            }
        }

        const message = [
            "Generated files must declare, never execute. A module-scope call makes",
            "the module's observable effect depend on whether and when something",
            "imported it:",
            ...offenders.map((o) => `  - ${o}`),
        ].join("\n");

        expect(offenders, message).toEqual([]);
    });

    it("test the topology module holds no mutable module-level state", () => {
        const file = path.join(PACKAGES_DIR, "server/src/topology.ts");
        const source = readFileSync(file, "utf8");

        // Module-level bindings are declared at column 0. `let`/`var`, or a `const`
        // bound to a mutable collection, is the process-wide state this ticket removed.
        const offenders = source
            .split("\n")
            .filter(
                (line) =>
                    /^(export\s+)?(let|var)\s/.test(line) ||
                    /^(export\s+)?const\s+\w+\s*(:[^=]+)?=\s*new\s+(Map|Set|WeakMap|WeakSet)\b/.test(
                        line,
                    ),
            );

        const message = [
            "packages/server/src/topology.ts must stay stateless — the scope chain is",
            "derived from ctx.containment, not from anything the module accumulates:",
            ...offenders.map((o) => `  - ${o.trim()}`),
        ].join("\n");

        expect(offenders, message).toEqual([]);
    });
});
