/**
 * Architecture gate — TripleStore is internal (closes TRN-197).
 *
 * TripleStore is the low-level RDF quad store.  The public data-access API is
 * EntityStore / EntityQuery (plus the entity-infrastructure that builds them).
 * Every bounded-context repo has been migrated onto EntityStore, so this test
 * locks in the win: it scans the source tree and FAILS if any file imports
 * `TripleStore` from `@jasonscharf/data` unless that file is on the explicit
 * ALLOWLIST below.  The intent is to stop NEW direct TripleStore data access —
 * not to refactor the existing legitimate importers.
 *
 * The gate is deliberately additive and low-churn: it does not move the
 * `@jasonscharf/data` re-export behind an `/internal` entry point (that would
 * touch dozens of files).  It just prevents regressions.
 *
 * HOW TO (rarely) EXTEND THE ALLOWLIST
 * ────────────────────────────────────
 * Only add a path here if the file is genuinely part of the entity
 * infrastructure, a migration, a documented host-side `get store()` seam, or a
 * sandbox demo.  If you find yourself wanting to add an ordinary repository or
 * service, migrate it onto EntityStore / EntityQuery instead.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Repo root: this file lives at packages/test/src/architecture/<file>, so the
// workspace root is four directories up.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../..");
const PACKAGES_DIR = path.join(REPO_ROOT, "packages");

/**
 * Files (relative to the repo root, POSIX separators) that are PERMITTED to
 * import `TripleStore` from `@jasonscharf/data`.  Grouped by why they are
 * legitimate.  Captured as the baseline on `main` so the gate is GREEN today.
 */
const ALLOWLIST: ReadonlyArray<string> = [
    // ── Entity infrastructure (the public data API is built here) ──────────────
    "packages/server/src/CollectionView.ts",
    "packages/server/src/EntityQuery.ts",
    "packages/server/src/EntityStore.ts",
    "packages/server/src/ExtensionRegistry.ts",
    "packages/server/src/GraphQuery.ts",
    "packages/server/src/SchemaRegistry.ts",
    "packages/server/src/ServerContext.ts",

    // ── Host-side application seam ─────────────────────────────────────────────
    // SystemApp/extensions build a ServerContext from a host-provided store.
    "packages/app/src/SystemApp.ts",
    "packages/app/src/config/types.ts",

    // ── Repository files that keep a documented `get store(): TripleStore` seam ─
    // (the host-side seam AuthService/components use to build a ServerContext)
    "packages/auth/src/repository/LoginAttemptRepository.ts",
    "packages/auth/src/repository/UserDeviceRepository.ts",
    "packages/auth/src/repository/UserIdentityRepository.ts",
    "packages/auth/src/repository/UserRepository.ts",
    "packages/auth/src/repository/UserSessionRepository.ts",
    "packages/convos/src/extension.ts",
    "packages/convos/src/repository/ConversationRepository.ts",
    "packages/convos/src/repository/DraftRepository.ts",
    "packages/convos/src/repository/InboxRepository.ts",
    "packages/convos/src/repository/MessageRepository.ts",
    "packages/convos/src/repository/NotificationRepository.ts",
    "packages/convos/src/repository/ParticipantRepository.ts",
    "packages/convos/src/repository/ReadReceiptRepository.ts",
    "packages/server/src/audit/AuditRepository.ts",
    "packages/server/src/tenancy/OrganizationRepository.ts",
    "packages/server/src/tenancy/TenantRepository.ts",

    // ── RBAC service + repositories (same host-side seam) ──────────────────────
    "packages/server/src/rbac/AccessChecker.ts",
    "packages/server/src/rbac/RbacInspector.ts",
    "packages/server/src/rbac/RbacService.ts",
    "packages/server/src/rbac/extension.ts",
    "packages/server/src/rbac/seed.ts",
    "packages/server/src/rbac/repository/PermissionRepository.ts",
    "packages/server/src/rbac/repository/PolicyGrantRepository.ts",
    "packages/server/src/rbac/repository/ResourceNodeRepository.ts",
    "packages/server/src/rbac/repository/RoleRepository.ts",
    "packages/server/src/rbac/repository/ServiceAccountRepository.ts",
    "packages/server/src/rbac/repository/UserGroupRepository.ts",

    // ── Sandbox `triples` demo (intentionally exercises raw quad access) ───────
    "packages/sandbox-server/src/handlers/triples.ts",
    "packages/sandbox-server/src/index.ts",
    "packages/sandbox-server/src/examples/rbac.ts",
];

/**
 * Whole packages that are allowed wholesale:
 *  - `data` owns and re-exports TripleStore.
 *  - `test` is the test harness; tests legitimately drive the raw store.
 */
const ALLOWED_PACKAGES: ReadonlyArray<string> = ["data", "test"];

const ALLOWLIST_SET = new Set(ALLOWLIST);

/**
 * Matches an ESM import that pulls `TripleStore` (named or type-only) from
 * `@jasonscharf/data`.  Examples it catches:
 *   import { TripleStore } from "@jasonscharf/data";
 *   import type { TripleStore } from "@jasonscharf/data";
 *   import { createDataContext, TripleStore } from "@jasonscharf/data";
 *   import { type QuadPattern, TripleStore } from "@jasonscharf/data";
 */
const IMPORT_RE =
    /import\s+(?:type\s+)?\{[^}]*\bTripleStore\b[^}]*\}\s*from\s*["']@jasonscharf\/data["']/;

function listTsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === "node_modules" || entry === "dist") {
                continue;
            }
            out.push(...listTsFiles(full));
            continue;
        }
        if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
            out.push(full);
        }
    }
    return out;
}

function packageOf(relPath: string): string {
    // relPath like "packages/<pkg>/src/..."
    return relPath.split("/")[1] ?? "";
}

describe("architecture: TripleStore is internal (TRN-197)", () => {
    it("no file outside the allowlist imports TripleStore from @jasonscharf/data", () => {
        const violations: string[] = [];

        for (const pkg of readdirSync(PACKAGES_DIR)) {
            const srcDir = path.join(PACKAGES_DIR, pkg, "src");
            let isDir = false;
            try {
                isDir = statSync(srcDir).isDirectory();
            } catch {
                isDir = false;
            }
            if (!isDir) {
                continue;
            }
            if (ALLOWED_PACKAGES.includes(pkg)) {
                continue;
            }

            for (const file of listTsFiles(srcDir)) {
                const relPath = path.relative(REPO_ROOT, file).split(path.sep).join("/");
                if (ALLOWLIST_SET.has(relPath)) {
                    continue;
                }
                const text = readFileSync(file, "utf8");
                if (IMPORT_RE.test(text)) {
                    violations.push(relPath);
                }
            }
        }

        const message = [
            "TripleStore is internal — use EntityStore / EntityQuery instead.",
            "These files import TripleStore from @jasonscharf/data but are NOT on the allowlist:",
            ...violations.map((v) => `  - ${v}`),
            "",
            "If this is genuinely entity-infrastructure / a migration / a documented",
            "host-side `get store()` seam, add the path to ALLOWLIST in this test.",
            "Otherwise migrate the file onto EntityStore / EntityQuery.",
        ].join("\n");

        expect(violations, message).toEqual([]);
    });

    it("every allowlisted path still imports TripleStore (no stale entries)", () => {
        const stale: string[] = [];
        for (const relPath of ALLOWLIST) {
            const full = path.join(REPO_ROOT, relPath);
            let text: string;
            try {
                text = readFileSync(full, "utf8");
            } catch {
                stale.push(`${relPath} (missing file)`);
                continue;
            }
            // packageOf guards against an allowlisted path leaking into an
            // ALLOWED_PACKAGES bucket (which the gate already skips wholesale).
            if (ALLOWED_PACKAGES.includes(packageOf(relPath))) {
                stale.push(`${relPath} (covered by ALLOWED_PACKAGES — remove)`);
                continue;
            }
            if (!IMPORT_RE.test(text)) {
                stale.push(`${relPath} (no longer imports TripleStore — remove)`);
            }
        }

        const message = [
            "Stale ALLOWLIST entries — these no longer import TripleStore (or moved):",
            ...stale.map((s) => `  - ${s}`),
            "Remove them so the allowlist stays an accurate baseline.",
        ].join("\n");

        expect(stale, message).toEqual([]);
    });
});
