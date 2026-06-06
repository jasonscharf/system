/**
 * Generator proof on the real RBAC ontology.
 *
 * Runs generateSchemas() over packages/core/ontology/rbac.ttl and asserts that
 * the ontology's own data/topology split becomes edge-based EntitySchemas:
 * datatype properties → properties, object properties → edges (polymorphic ones
 * targetless, typed ones via forward thunks).  This is the end-to-end proof that
 * foreign-key destruction is ontology-driven, not hand-coded.
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Triple } from "@jasonscharf/core";
import { generateSchemas, parseTurtle, readOntology } from "@jasonscharf/gen";
import { beforeAll, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const rbacTtl = join(here, "../../../core/ontology/rbac.ttl");

let src = "";

beforeAll(async () => {
    const content = await readFile(rbacTtl, "utf-8");
    const triples: Triple[] = [];
    for await (const t of parseTurtle(content)) {
        triples.push(t);
    }
    const ontology = readOntology(triples);
    src = generateSchemas(
        ontology,
        { nodeShapes: new Map(), byTargetClass: new Map() },
        { localNamespace: "http://tern.dev/ns/rbac/", iriImport: "@jasonscharf/core" },
    );
});

describe("generateSchemas — real rbac.ttl", () => {
    it("emits an EntitySchema for each RBAC class", () => {
        for (const name of [
            "TenantSchema",
            "UserGroupSchema",
            "RoleSchema",
            "PermissionSchema",
            "PolicyGrantSchema",
            "ResourceNodeSchema",
        ]) {
            expect(src).toContain(`export const ${name} = new EntitySchema({`);
        }
    });

    it("keeps datatype properties as literal properties (no fooId)", () => {
        expect(src).toContain('tenantName: new IRI("http://tern.dev/ns/rbac/tenantName")');
        expect(src).toContain('permissionKey: new IRI("http://tern.dev/ns/rbac/permissionKey")');
        // FK scalars must not appear as literal properties.
        expect(src).not.toContain("tenantId:");
        expect(src).not.toContain("parentIri:");
        expect(src).not.toContain("principalIri:");
    });

    it("models typed object properties as edges via forward thunks", () => {
        // Role --inheritsFrom--> Role, Role --grants--> Permission (self/local targets).
        expect(src).toContain("inheritsFrom: { predicate:");
        expect(src).toContain("target: () => RoleSchema");
        expect(src).toContain("target: () => PermissionSchema");
        // ResourceNode --parentResource--> ResourceNode (the subtree edge).
        expect(src).toContain("parentResource: { predicate:");
        expect(src).toContain("target: () => ResourceNodeSchema");
        // PolicyGrant --grantRole--> Role.
        expect(src).toContain("grantRole: { predicate:");
    });

    it("models polymorphic object properties (no rdfs:range) as targetless edges", () => {
        // grantPrincipal / grantScope are scoped to PolicyGrant but have no single
        // target class (principal: User|Group|ServiceAccount; scope: Resource|Tenant).
        expect(src).toContain(
            'grantPrincipal: { predicate: new IRI("http://tern.dev/ns/rbac/grantPrincipal"), cardinality: "many", direction: "out" }',
        );
        expect(src).toContain(
            'grantScope: { predicate: new IRI("http://tern.dev/ns/rbac/grantScope"), cardinality: "many", direction: "out" }',
        );
        // A polymorphic edge carries no target thunk.
        for (const edge of ["grantPrincipal", "grantScope"]) {
            const line = src.split("\n").find((l) => l.includes(`${edge}: { predicate:`));
            expect(line).toBeDefined();
            expect(line).not.toContain("target:");
        }
    });
});
