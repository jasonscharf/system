/**
 * RBAC integration tests.
 *
 * Every suite runs against both SQLite (always) and Postgres (when TERN_PG_URL
 * is set), each in a rolled-back transaction for clean isolation.
 *
 * Scenarios are drawn from a fictional B2B SaaS called "Tern Cloud" with two
 * tenants — Acme Corp and Globex Corp — and a set of real-world principals,
 * groups, roles, and resources.
 */

import { createDataContext, TripleStore } from "@jasonscharf/data";
import {
    AccessChecker,
    PermissionRepository,
    PolicyGrantRepository,
    RbacService,
    ResourceNodeRepository,
    RoleRepository,
    ServiceAccountRepository,
    SYS_SUPERUSERS_IRI,
    TenantRepository,
    UserGroupRepository,
} from "@jasonscharf/rbac";
import { defaultServerContext, type ServerContext } from "@jasonscharf/server";
import type { Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { up as seedRbac } from "../../../data/src/migrations/004_rbac.js";

// ── Provider matrix ───────────────────────────────────────────────────────────

interface DbProvider {
    name: string;
    create(): Promise<Knex>;
}

const providers: DbProvider[] = [
    {
        name: "SQLite (in-memory)",
        create: () => createDataContext({ client: "sqlite", filename: ":memory:" }),
    },
];

if (process.env.TERN_PG_URL) {
    const url = new URL(process.env.TERN_PG_URL);
    providers.push({
        name: "Postgres",
        create: () =>
            createDataContext({
                client: "pg",
                host: url.hostname,
                port: url.port ? Number(url.port) : 5432,
                database: url.pathname.slice(1),
                user: url.username,
                password: url.password,
            }),
    });
}

// ── Synthetic user IRIs (no auth dependency) ──────────────────────────────────

const ALICE = "http://tern.dev/ns/auth/user/test-alice";
const BOB = "http://tern.dev/ns/auth/user/test-bob";
const CHARLIE = "http://tern.dev/ns/auth/user/test-charlie";
const DAVE = "http://tern.dev/ns/auth/user/test-dave"; // Globex user

// ── Shared suite (runs once per provider) ─────────────────────────────────────

for (const provider of providers) {
    describe(`RBAC — ${provider.name}`, () => {
        let knex: Knex;
        let store: TripleStore;
        let trx: Knex.Transaction;
        let ctx: ServerContext;
        let rbac: RbacService;

        beforeEach(async () => {
            knex = await provider.create();
            await seedRbac(knex); // inserts system tenant, superusers, superadmin, wildcard
            trx = await knex.transaction();
            store = new TripleStore(knex);
            ctx = { trx };

            const tenants = new TenantRepository(store);
            const groups = new UserGroupRepository(store);
            const roles = new RoleRepository(store);
            const grants = new PolicyGrantRepository(store);
            const permissions = new PermissionRepository(store);
            const resources = new ResourceNodeRepository(store);
            const serviceAccounts = new ServiceAccountRepository(store);

            rbac = new RbacService({
                store,
                tenants,
                groups,
                roles,
                grants,
                permissions,
                resources,
                serviceAccounts,
            });
        });

        afterEach(async () => {
            await trx.rollback();
            await knex.destroy();
        });

        // ── Migration bootstrap ───────────────────────────────────────────────

        describe("migration 004 bootstrap", () => {
            it("superadmin role has wildcard permission", async () => {
                const allowed = await rbac.can(ctx, {
                    principal: ALICE,
                    permission: "anything.atAll",
                });
                // ALICE is not in superusers yet, so denied
                expect(allowed).toBe(false);
            });

            it("seeding is idempotent — running migration twice does not error", async () => {
                // Use a separate DB to avoid conflicting with the open test transaction
                const freshKnex = await provider.create();
                await seedRbac(freshKnex);
                await expect(seedRbac(freshKnex)).resolves.toBeUndefined();
                await freshKnex.destroy();
            });
        });

        // ── Tenants and groups ────────────────────────────────────────────────

        describe("tenants and groups", () => {
            it("creates a tenant", async () => {
                const acme = await rbac.createTenant(ctx, "Acme Corp");
                expect(acme.tenantName).toBe("Acme Corp");
                expect(acme.isSystemTenant).toBe(false);
                expect(acme.id).toBeTruthy();
            });

            it("creates a group inside a tenant", async () => {
                const acme = await rbac.createTenant(ctx, "Acme Corp");
                const admins = await rbac.createUserGroup(ctx, {
                    groupName: "Admins",
                    tenantId: acme.id,
                });
                expect(admins.groupName).toBe("Admins");
                expect(admins.tenantId).toBe(acme.id);
            });

            it("adds a member to a group", async () => {
                const acme = await rbac.createTenant(ctx, "Acme Corp");
                const group = await rbac.createUserGroup(ctx, {
                    groupName: "Staff",
                    tenantId: acme.id,
                });
                await rbac.addMember(ctx, group.iri, ALICE);
                const members = await rbac.listMembers(ctx, group.iri);
                expect(members).toContain(ALICE);
            });

            it("removes a member from a group", async () => {
                const acme = await rbac.createTenant(ctx, "Acme Corp");
                const group = await rbac.createUserGroup(ctx, {
                    groupName: "Staff",
                    tenantId: acme.id,
                });
                await rbac.addMember(ctx, group.iri, ALICE);
                await rbac.removeMember(ctx, group.iri, ALICE);
                const members = await rbac.listMembers(ctx, group.iri);
                expect(members).not.toContain(ALICE);
            });
        });

        // ── UserGroup CRUD ────────────────────────────────────────────────────

        describe("UserGroup CRUD", () => {
            it("findByName returns the group", async () => {
                const acme = await rbac.createTenant(ctx, "Acme Corp");
                await rbac.createUserGroup(ctx, { groupName: "Engineering", tenantId: acme.id });
                const found = await rbac.findUserGroupByName(ctx, "Engineering", acme.id);
                expect(found?.groupName).toBe("Engineering");
            });

            it("findByName returns null when name does not exist", async () => {
                const found = await rbac.findUserGroupByName(ctx, "Nobody");
                expect(found).toBeNull();
            });

            it("listUserGroups returns all groups for a tenant", async () => {
                const acme = await rbac.createTenant(ctx, "Acme Corp");
                await rbac.createUserGroup(ctx, { groupName: "Eng", tenantId: acme.id });
                await rbac.createUserGroup(ctx, { groupName: "Design", tenantId: acme.id });
                const groups = await rbac.listUserGroups(ctx, acme.id);
                expect(groups.map((g) => g.groupName)).toEqual(
                    expect.arrayContaining(["Eng", "Design"]),
                );
            });

            it("updateUserGroup renames the group", async () => {
                const acme = await rbac.createTenant(ctx, "Acme Corp");
                const group = await rbac.createUserGroup(ctx, {
                    groupName: "OldName",
                    tenantId: acme.id,
                });
                const updated = await rbac.updateUserGroup(ctx, group.id, {
                    groupName: "NewName",
                });
                expect(updated?.groupName).toBe("NewName");
            });

            it("deleteUserGroup removes the group and its memberships", async () => {
                const acme = await rbac.createTenant(ctx, "Acme Corp");
                const group = await rbac.createUserGroup(ctx, {
                    groupName: "Temp",
                    tenantId: acme.id,
                });
                await rbac.addMember(ctx, group.iri, ALICE);
                await rbac.deleteUserGroup(ctx, group.id);

                // Group is gone
                expect(await rbac.getUserGroup(ctx, group.id)).toBeNull();
                // Alice is no longer in it
                const members = await rbac.listMembers(ctx, group.iri);
                expect(members).toHaveLength(0);
            });

            it("getUserGroup returns null for unknown id", async () => {
                expect(await rbac.getUserGroup(ctx, "nonexistent")).toBeNull();
            });
        });

        // ── RbacInspector ─────────────────────────────────────────────────────

        describe("RbacInspector", () => {
            it("listEffectivePermissions delegates to AccessChecker", async () => {
                const perm = await rbac.createPermission(ctx, "report.view");
                const role = await rbac.createRole(ctx, { roleName: "Reporter", tenantId: null });
                await rbac.addPermissionToRole(ctx, role.iri, perm.iri);
                await rbac.grant(ctx, { principalIri: ALICE, roleIri: role.iri });

                const inspector = rbac.inspector();
                const perms = await inspector.listEffectivePermissions(ctx, ALICE);
                expect(perms.has("report.view")).toBe(true);
            });

            it("explain returns allowed:true with a grant path for a direct grant", async () => {
                const perm = await rbac.createPermission(ctx, "invoice.read");
                const role = await rbac.createRole(ctx, {
                    roleName: "BillingViewer",
                    tenantId: null,
                });
                await rbac.addPermissionToRole(ctx, role.iri, perm.iri);
                await rbac.grant(ctx, { principalIri: ALICE, roleIri: role.iri });

                const inspector = rbac.inspector();
                const result = await inspector.explain(ctx, {
                    principal: ALICE,
                    permission: "invoice.read",
                });
                expect(result.allowed).toBe(true);
                expect(result.allowedBy).toHaveLength(1);
                expect(result.allowedBy[0].roleIri).toBe(role.iri);
                expect(result.allowedBy[0].membershipChain).toHaveLength(0);
                expect(result.deniedBy).toHaveLength(0);
            });

            it("explain shows membership chain when permission comes via a group", async () => {
                const perm = await rbac.createPermission(ctx, "deploy.run");
                const role = await rbac.createRole(ctx, { roleName: "Deployer", tenantId: null });
                await rbac.addPermissionToRole(ctx, role.iri, perm.iri);
                const group = await rbac.createUserGroup(ctx, { groupName: "Ops", tenantId: null });
                await rbac.addMember(ctx, group.iri, ALICE);
                await rbac.grant(ctx, { principalIri: group.iri, roleIri: role.iri });

                const inspector = rbac.inspector();
                const result = await inspector.explain(ctx, {
                    principal: ALICE,
                    permission: "deploy.run",
                });
                expect(result.allowed).toBe(true);
                expect(result.allowedBy[0].membershipChain).toContain(group.iri);
            });

            it("explain shows roleInheritanceChain when permission is inherited", async () => {
                const read = await rbac.createPermission(ctx, "doc.read");
                const viewer = await rbac.createRole(ctx, { roleName: "Viewer", tenantId: null });
                await rbac.addPermissionToRole(ctx, viewer.iri, read.iri);
                const editor = await rbac.createRole(ctx, { roleName: "Editor", tenantId: null });
                await rbac.addRoleInheritance(ctx, editor.iri, viewer.iri);
                await rbac.grant(ctx, { principalIri: ALICE, roleIri: editor.iri });

                const inspector = rbac.inspector();
                const result = await inspector.explain(ctx, {
                    principal: ALICE,
                    permission: "doc.read",
                });
                expect(result.allowed).toBe(true);
                expect(result.allowedBy[0].roleIri).toBe(editor.iri);
                expect(result.allowedBy[0].roleInheritanceChain).toContain(viewer.iri);
            });

            it("explain returns allowed:false with deniedBy populated for a denial", async () => {
                const perm = await rbac.createPermission(ctx, "billing.delete");
                const role = await rbac.createRole(ctx, {
                    roleName: "BillingOwner",
                    tenantId: null,
                });
                await rbac.addPermissionToRole(ctx, role.iri, perm.iri);
                await rbac.grant(ctx, { principalIri: ALICE, roleIri: role.iri });
                await rbac.grant(ctx, { principalIri: ALICE, roleIri: role.iri, isDenial: true });

                const inspector = rbac.inspector();
                const result = await inspector.explain(ctx, {
                    principal: ALICE,
                    permission: "billing.delete",
                });
                expect(result.allowed).toBe(false);
                expect(result.deniedBy.length).toBeGreaterThan(0);
            });

            it("explain returns allowed:false with empty paths for a principal with no grants", async () => {
                const inspector = rbac.inspector();
                const result = await inspector.explain(ctx, {
                    principal: DAVE,
                    permission: "anything",
                });
                expect(result.allowed).toBe(false);
                expect(result.allowedBy).toHaveLength(0);
            });

            it("listGroupMemberships returns direct groups", async () => {
                const g1 = await rbac.createUserGroup(ctx, { groupName: "G1", tenantId: null });
                const g2 = await rbac.createUserGroup(ctx, { groupName: "G2", tenantId: null });
                await rbac.addMember(ctx, g1.iri, ALICE);
                await rbac.addMember(ctx, g2.iri, ALICE);

                const inspector = rbac.inspector();
                const groups = await inspector.listGroupMemberships(ctx, ALICE);
                const names = groups.map((g) => g.groupName);
                expect(names).toContain("G1");
                expect(names).toContain("G2");
            });

            it("listGroupMemberships transitive includes nested groups", async () => {
                const parent = await rbac.createUserGroup(ctx, {
                    groupName: "Parent",
                    tenantId: null,
                });
                const child = await rbac.createUserGroup(ctx, {
                    groupName: "Child",
                    tenantId: null,
                });
                await rbac.addMember(ctx, parent.iri, child.iri); // child is member of parent
                await rbac.addMember(ctx, child.iri, ALICE); // ALICE is member of child

                const inspector = rbac.inspector();
                const direct = await inspector.listGroupMemberships(ctx, ALICE);
                const transitive = await inspector.listGroupMemberships(ctx, ALICE, {
                    transitive: true,
                });
                expect(direct.map((g) => g.groupName)).toContain("Child");
                expect(direct.map((g) => g.groupName)).not.toContain("Parent");
                expect(transitive.map((g) => g.groupName)).toContain("Child");
                expect(transitive.map((g) => g.groupName)).toContain("Parent");
            });

            it("listGroupMembers returns direct members", async () => {
                const group = await rbac.createUserGroup(ctx, {
                    groupName: "Team",
                    tenantId: null,
                });
                await rbac.addMember(ctx, group.iri, ALICE);
                await rbac.addMember(ctx, group.iri, BOB);

                const inspector = rbac.inspector();
                const members = await inspector.listGroupMembers(ctx, group.iri);
                expect(members).toContain(ALICE);
                expect(members).toContain(BOB);
            });

            it("listGroupMembers transitive expands nested groups", async () => {
                const outer = await rbac.createUserGroup(ctx, {
                    groupName: "Outer",
                    tenantId: null,
                });
                const inner = await rbac.createUserGroup(ctx, {
                    groupName: "Inner",
                    tenantId: null,
                });
                await rbac.addMember(ctx, outer.iri, inner.iri);
                await rbac.addMember(ctx, inner.iri, ALICE);

                const inspector = rbac.inspector();
                const direct = await inspector.listGroupMembers(ctx, outer.iri);
                const transitive = await inspector.listGroupMembers(ctx, outer.iri, {
                    transitive: true,
                });
                expect(direct).toContain(inner.iri);
                expect(direct).not.toContain(ALICE);
                expect(transitive).toContain(ALICE);
            });

            it("listGroupsWithMembers returns groups with their member lists", async () => {
                const acme = await rbac.createTenant(ctx, "Acme Corp");
                const g = await rbac.createUserGroup(ctx, { groupName: "Devs", tenantId: acme.id });
                await rbac.addMember(ctx, g.iri, ALICE);
                await rbac.addMember(ctx, g.iri, BOB);

                const inspector = rbac.inspector();
                const result = await inspector.listGroupsWithMembers(ctx, acme.id);
                const devs = result.find((r) => r.groupName === "Devs");
                expect(devs?.members).toContain(ALICE);
                expect(devs?.members).toContain(BOB);
            });
        });

        // ── Roles and permissions ─────────────────────────────────────────────

        describe("roles and permissions", () => {
            it("creates a role and assigns a permission", async () => {
                const acme = await rbac.createTenant(ctx, "Acme Corp");
                const read = await rbac.createPermission(ctx, "project.read");
                const viewer = await rbac.createRole(ctx, {
                    roleName: "Viewer",
                    tenantId: acme.id,
                });
                await rbac.addPermissionToRole(ctx, viewer.iri, read.iri);

                await rbac.grant(ctx, { principalIri: ALICE, roleIri: viewer.iri });

                expect(await rbac.can(ctx, { principal: ALICE, permission: "project.read" })).toBe(
                    true,
                );
                expect(await rbac.can(ctx, { principal: ALICE, permission: "project.write" })).toBe(
                    false,
                );
            });

            it("removing a permission from a role immediately revokes it", async () => {
                const read = await rbac.createPermission(ctx, "project.read");
                const role = await rbac.createRole(ctx, { roleName: "Viewer", tenantId: null });
                await rbac.addPermissionToRole(ctx, role.iri, read.iri);
                await rbac.grant(ctx, { principalIri: ALICE, roleIri: role.iri });

                expect(await rbac.can(ctx, { principal: ALICE, permission: "project.read" })).toBe(
                    true,
                );

                await rbac.removePermissionFromRole(ctx, role.iri, read.iri);
                expect(await rbac.can(ctx, { principal: ALICE, permission: "project.read" })).toBe(
                    false,
                );
            });
        });

        // ── Role inheritance ──────────────────────────────────────────────────

        describe("role inheritance", () => {
            it("child role inherits parent permissions", async () => {
                const read = await rbac.createPermission(ctx, "project.read");
                const write = await rbac.createPermission(ctx, "project.write");

                const viewer = await rbac.createRole(ctx, { roleName: "Viewer", tenantId: null });
                await rbac.addPermissionToRole(ctx, viewer.iri, read.iri);

                const editor = await rbac.createRole(ctx, { roleName: "Editor", tenantId: null });
                await rbac.addPermissionToRole(ctx, editor.iri, write.iri);
                await rbac.addRoleInheritance(ctx, editor.iri, viewer.iri); // editor inherits viewer

                await rbac.grant(ctx, { principalIri: ALICE, roleIri: editor.iri });

                expect(await rbac.can(ctx, { principal: ALICE, permission: "project.read" })).toBe(
                    true,
                );
                expect(await rbac.can(ctx, { principal: ALICE, permission: "project.write" })).toBe(
                    true,
                );
            });

            it("three-level inheritance chain propagates all permissions", async () => {
                const read = await rbac.createPermission(ctx, "project.read");
                const write = await rbac.createPermission(ctx, "project.write");
                const admin = await rbac.createPermission(ctx, "project.admin");

                const viewer = await rbac.createRole(ctx, { roleName: "Viewer", tenantId: null });
                await rbac.addPermissionToRole(ctx, viewer.iri, read.iri);

                const editor = await rbac.createRole(ctx, { roleName: "Editor", tenantId: null });
                await rbac.addPermissionToRole(ctx, editor.iri, write.iri);
                await rbac.addRoleInheritance(ctx, editor.iri, viewer.iri);

                const owner = await rbac.createRole(ctx, { roleName: "Owner", tenantId: null });
                await rbac.addPermissionToRole(ctx, owner.iri, admin.iri);
                await rbac.addRoleInheritance(ctx, owner.iri, editor.iri);

                await rbac.grant(ctx, { principalIri: ALICE, roleIri: owner.iri });

                expect(await rbac.can(ctx, { principal: ALICE, permission: "project.read" })).toBe(
                    true,
                );
                expect(await rbac.can(ctx, { principal: ALICE, permission: "project.write" })).toBe(
                    true,
                );
                expect(await rbac.can(ctx, { principal: ALICE, permission: "project.admin" })).toBe(
                    true,
                );
                expect(await rbac.can(ctx, { principal: ALICE, permission: "billing.write" })).toBe(
                    false,
                );
            });

            it("non-inherited sibling role permissions do not bleed across", async () => {
                const permA = await rbac.createPermission(ctx, "a.action");
                const permB = await rbac.createPermission(ctx, "b.action");

                const roleA = await rbac.createRole(ctx, { roleName: "RoleA", tenantId: null });
                await rbac.addPermissionToRole(ctx, roleA.iri, permA.iri);

                const roleB = await rbac.createRole(ctx, { roleName: "RoleB", tenantId: null });
                await rbac.addPermissionToRole(ctx, roleB.iri, permB.iri);

                await rbac.grant(ctx, { principalIri: ALICE, roleIri: roleA.iri });

                expect(await rbac.can(ctx, { principal: ALICE, permission: "a.action" })).toBe(
                    true,
                );
                expect(await rbac.can(ctx, { principal: ALICE, permission: "b.action" })).toBe(
                    false,
                );
            });
        });

        // ── Group-based access control ────────────────────────────────────────

        describe("group-based access", () => {
            it("user inherits role via group membership", async () => {
                const read = await rbac.createPermission(ctx, "project.read");
                const role = await rbac.createRole(ctx, { roleName: "Viewer", tenantId: null });
                await rbac.addPermissionToRole(ctx, role.iri, read.iri);

                const group = await rbac.createUserGroup(ctx, {
                    groupName: "Staff",
                    tenantId: null,
                });
                await rbac.addMember(ctx, group.iri, ALICE);
                await rbac.grant(ctx, { principalIri: group.iri, roleIri: role.iri });

                expect(await rbac.can(ctx, { principal: ALICE, permission: "project.read" })).toBe(
                    true,
                );
                // Non-member Bob cannot
                expect(await rbac.can(ctx, { principal: BOB, permission: "project.read" })).toBe(
                    false,
                );
            });

            it("nested groups: user in subgroup gains parent-group permissions", async () => {
                const manage = await rbac.createPermission(ctx, "user.manage");
                const adminRole = await rbac.createRole(ctx, { roleName: "Admin", tenantId: null });
                await rbac.addPermissionToRole(ctx, adminRole.iri, manage.iri);

                const admins = await rbac.createUserGroup(ctx, {
                    groupName: "Admins",
                    tenantId: null,
                });
                const superAdmins = await rbac.createUserGroup(ctx, {
                    groupName: "SuperAdmins",
                    tenantId: null,
                });

                // superAdmins is a member of admins (nested group)
                await rbac.addMember(ctx, admins.iri, superAdmins.iri);
                await rbac.grant(ctx, { principalIri: admins.iri, roleIri: adminRole.iri });

                // Alice is in superAdmins
                await rbac.addMember(ctx, superAdmins.iri, ALICE);

                // Alice should inherit via: ALICE → superAdmins → admins → Admin role → user.manage
                expect(await rbac.can(ctx, { principal: ALICE, permission: "user.manage" })).toBe(
                    true,
                );
            });

            it("revoking group membership removes inherited permissions", async () => {
                const read = await rbac.createPermission(ctx, "project.read");
                const role = await rbac.createRole(ctx, { roleName: "Viewer", tenantId: null });
                await rbac.addPermissionToRole(ctx, role.iri, read.iri);
                const group = await rbac.createUserGroup(ctx, {
                    groupName: "Staff",
                    tenantId: null,
                });
                await rbac.addMember(ctx, group.iri, ALICE);
                await rbac.grant(ctx, { principalIri: group.iri, roleIri: role.iri });

                expect(await rbac.can(ctx, { principal: ALICE, permission: "project.read" })).toBe(
                    true,
                );

                await rbac.removeMember(ctx, group.iri, ALICE);
                expect(await rbac.can(ctx, { principal: ALICE, permission: "project.read" })).toBe(
                    false,
                );
            });
        });

        // ── Explicit denials ──────────────────────────────────────────────────

        describe("explicit denials", () => {
            it("denial blocks an otherwise-allowed permission", async () => {
                const read = await rbac.createPermission(ctx, "billing.read");
                const role = await rbac.createRole(ctx, { roleName: "Viewer", tenantId: null });
                await rbac.addPermissionToRole(ctx, role.iri, read.iri);
                const group = await rbac.createUserGroup(ctx, {
                    groupName: "Staff",
                    tenantId: null,
                });
                await rbac.addMember(ctx, group.iri, ALICE);
                await rbac.grant(ctx, { principalIri: group.iri, roleIri: role.iri });

                // Explicit denial directly on Alice
                await rbac.grant(ctx, {
                    principalIri: ALICE,
                    roleIri: role.iri,
                    isDenial: true,
                });

                expect(await rbac.can(ctx, { principal: ALICE, permission: "billing.read" })).toBe(
                    false,
                );
            });

            it("denial does not affect other principals in the same group", async () => {
                const read = await rbac.createPermission(ctx, "billing.read");
                const role = await rbac.createRole(ctx, { roleName: "Viewer", tenantId: null });
                await rbac.addPermissionToRole(ctx, role.iri, read.iri);
                const group = await rbac.createUserGroup(ctx, {
                    groupName: "Staff",
                    tenantId: null,
                });
                await rbac.addMember(ctx, group.iri, ALICE);
                await rbac.addMember(ctx, group.iri, BOB);
                await rbac.grant(ctx, { principalIri: group.iri, roleIri: role.iri });

                // Deny only Alice
                await rbac.grant(ctx, { principalIri: ALICE, roleIri: role.iri, isDenial: true });

                expect(await rbac.can(ctx, { principal: ALICE, permission: "billing.read" })).toBe(
                    false,
                );
                expect(await rbac.can(ctx, { principal: BOB, permission: "billing.read" })).toBe(
                    true,
                );
            });
        });

        // ── Temporary grants ──────────────────────────────────────────────────

        describe("temporary grants", () => {
            it("grant with future expiry is honoured", async () => {
                const perm = await rbac.createPermission(ctx, "temp.access");
                const role = await rbac.createRole(ctx, { roleName: "TempRole", tenantId: null });
                await rbac.addPermissionToRole(ctx, role.iri, perm.iri);

                const expiresAt = new Date(Date.now() + 60_000); // 1 minute from now
                await rbac.grant(ctx, {
                    principalIri: ALICE,
                    roleIri: role.iri,
                    grantExpiresAt: expiresAt,
                });

                expect(await rbac.can(ctx, { principal: ALICE, permission: "temp.access" })).toBe(
                    true,
                );
            });

            it("grant with past expiry is not honoured", async () => {
                const perm = await rbac.createPermission(ctx, "temp.access");
                const role = await rbac.createRole(ctx, { roleName: "TempRole", tenantId: null });
                await rbac.addPermissionToRole(ctx, role.iri, perm.iri);

                const expired = new Date(Date.now() - 1); // already in the past
                await rbac.grant(ctx, {
                    principalIri: ALICE,
                    roleIri: role.iri,
                    grantExpiresAt: expired,
                });

                expect(await rbac.can(ctx, { principal: ALICE, permission: "temp.access" })).toBe(
                    false,
                );
            });

            it("revoking a grant immediately removes access", async () => {
                const perm = await rbac.createPermission(ctx, "project.write");
                const role = await rbac.createRole(ctx, { roleName: "Editor", tenantId: null });
                await rbac.addPermissionToRole(ctx, role.iri, perm.iri);
                const g = await rbac.grant(ctx, { principalIri: ALICE, roleIri: role.iri });

                expect(await rbac.can(ctx, { principal: ALICE, permission: "project.write" })).toBe(
                    true,
                );

                await rbac.revoke(ctx, g.iri);
                expect(await rbac.can(ctx, { principal: ALICE, permission: "project.write" })).toBe(
                    false,
                );
            });
        });

        // ── Resource-scoped grants ────────────────────────────────────────────

        describe("resource-scoped grants", () => {
            it("system-wide grant (no scope) allows access on any resource", async () => {
                const read = await rbac.createPermission(ctx, "project.read");
                const role = await rbac.createRole(ctx, { roleName: "Reader", tenantId: null });
                await rbac.addPermissionToRole(ctx, role.iri, read.iri);
                const project = await rbac.createResource(ctx, { resourceType: "project" });

                await rbac.grant(ctx, { principalIri: ALICE, roleIri: role.iri });

                expect(
                    await rbac.can(ctx, {
                        principal: ALICE,
                        permission: "project.read",
                        scope: project.iri,
                    }),
                ).toBe(true);
            });

            it("resource-scoped grant only allows access on that resource", async () => {
                const read = await rbac.createPermission(ctx, "project.read");
                const role = await rbac.createRole(ctx, { roleName: "Reader", tenantId: null });
                await rbac.addPermissionToRole(ctx, role.iri, read.iri);
                const projectA = await rbac.createResource(ctx, { resourceType: "project" });
                const projectB = await rbac.createResource(ctx, { resourceType: "project" });

                await rbac.grant(ctx, {
                    principalIri: ALICE,
                    roleIri: role.iri,
                    scopeIri: projectA.iri,
                });

                expect(
                    await rbac.can(ctx, {
                        principal: ALICE,
                        permission: "project.read",
                        scope: projectA.iri,
                    }),
                ).toBe(true);
                expect(
                    await rbac.can(ctx, {
                        principal: ALICE,
                        permission: "project.read",
                        scope: projectB.iri,
                    }),
                ).toBe(false);
                expect(await rbac.can(ctx, { principal: ALICE, permission: "project.read" })).toBe(
                    false,
                );
            });

            it("grant on parent resource applies to child (scope chain)", async () => {
                const read = await rbac.createPermission(ctx, "file.read");
                const role = await rbac.createRole(ctx, { roleName: "Reader", tenantId: null });
                await rbac.addPermissionToRole(ctx, role.iri, read.iri);

                const project = await rbac.createResource(ctx, { resourceType: "project" });
                const folder = await rbac.createResource(ctx, {
                    resourceType: "folder",
                    parentIri: project.iri,
                });
                const file = await rbac.createResource(ctx, {
                    resourceType: "file",
                    parentIri: folder.iri,
                });

                // Grant scoped to the top-level project
                await rbac.grant(ctx, {
                    principalIri: ALICE,
                    roleIri: role.iri,
                    scopeIri: project.iri,
                });

                // Should propagate down through folder → file
                expect(
                    await rbac.can(ctx, {
                        principal: ALICE,
                        permission: "file.read",
                        scope: file.iri,
                    }),
                ).toBe(true);
                expect(
                    await rbac.can(ctx, {
                        principal: ALICE,
                        permission: "file.read",
                        scope: folder.iri,
                    }),
                ).toBe(true);
                expect(
                    await rbac.can(ctx, {
                        principal: ALICE,
                        permission: "file.read",
                        scope: project.iri,
                    }),
                ).toBe(true);
            });

            it("grant on sibling resource does not grant access to another sibling", async () => {
                const read = await rbac.createPermission(ctx, "file.read");
                const role = await rbac.createRole(ctx, { roleName: "Reader", tenantId: null });
                await rbac.addPermissionToRole(ctx, role.iri, read.iri);

                const folderA = await rbac.createResource(ctx, { resourceType: "folder" });
                const folderB = await rbac.createResource(ctx, { resourceType: "folder" });

                await rbac.grant(ctx, {
                    principalIri: ALICE,
                    roleIri: role.iri,
                    scopeIri: folderA.iri,
                });

                expect(
                    await rbac.can(ctx, {
                        principal: ALICE,
                        permission: "file.read",
                        scope: folderA.iri,
                    }),
                ).toBe(true);
                expect(
                    await rbac.can(ctx, {
                        principal: ALICE,
                        permission: "file.read",
                        scope: folderB.iri,
                    }),
                ).toBe(false);
            });

            it("resolvePermissions returns correct set for a scoped principal", async () => {
                const read = await rbac.createPermission(ctx, "doc.read");
                const write = await rbac.createPermission(ctx, "doc.write");

                const viewerRole = await rbac.createRole(ctx, {
                    roleName: "Viewer",
                    tenantId: null,
                });
                await rbac.addPermissionToRole(ctx, viewerRole.iri, read.iri);

                const editorRole = await rbac.createRole(ctx, {
                    roleName: "Editor",
                    tenantId: null,
                });
                await rbac.addPermissionToRole(ctx, editorRole.iri, write.iri);

                const resource = await rbac.createResource(ctx, { resourceType: "doc" });

                // Viewer grant system-wide; editor grant scoped to resource
                await rbac.grant(ctx, { principalIri: ALICE, roleIri: viewerRole.iri });
                await rbac.grant(ctx, {
                    principalIri: ALICE,
                    roleIri: editorRole.iri,
                    scopeIri: resource.iri,
                });

                const perms = await rbac.resolvePermissions(ctx, ALICE, resource.iri);
                expect(perms.has("doc.read")).toBe(true);
                expect(perms.has("doc.write")).toBe(true);
                expect(perms.has("doc.delete")).toBe(false);
            });
        });

        // ── Superusers (system wildcard) ──────────────────────────────────────

        describe("superusers (wildcard)", () => {
            it("member of superusers group can do anything", async () => {
                await rbac.addMember(ctx, SYS_SUPERUSERS_IRI, ALICE);

                expect(
                    await rbac.can(ctx, { principal: ALICE, permission: "any.permission" }),
                ).toBe(true);
                expect(
                    await rbac.can(ctx, { principal: ALICE, permission: "billing.delete" }),
                ).toBe(true);
                expect(
                    await rbac.can(ctx, { principal: ALICE, permission: "system.destroy" }),
                ).toBe(true);
            });

            it("non-superuser does not get wildcard", async () => {
                expect(await rbac.can(ctx, { principal: BOB, permission: "any.permission" })).toBe(
                    false,
                );
            });

            it("wildcard via resolvePermissions contains '*'", async () => {
                await rbac.addMember(ctx, SYS_SUPERUSERS_IRI, ALICE);
                const perms = await rbac.resolvePermissions(ctx, ALICE);
                expect(perms.has("*")).toBe(true);
            });
        });

        // ── Impersonation ─────────────────────────────────────────────────────

        describe("impersonation", () => {
            it("principal with actsFor can impersonate target and use their permissions", async () => {
                // Alice is the admin; agent service account will impersonate her
                const manage = await rbac.createPermission(ctx, "user.manage");
                const adminRole = await rbac.createRole(ctx, { roleName: "Admin", tenantId: null });
                await rbac.addPermissionToRole(ctx, adminRole.iri, manage.iri);
                await rbac.grant(ctx, { principalIri: ALICE, roleIri: adminRole.iri });

                const agent = await rbac.createServiceAccount(ctx, {
                    serviceAccountName: "agent",
                    serviceAccountToken: "token-abc",
                    tenantId: null,
                });
                await rbac.allowImpersonation(ctx, agent.iri, ALICE);

                // Agent has no permissions itself, but can act as Alice
                expect(
                    await rbac.can(ctx, { principal: agent.iri, permission: "user.manage" }),
                ).toBe(false);
                expect(
                    await rbac.can(ctx, {
                        principal: agent.iri,
                        permission: "user.manage",
                        actingAs: ALICE,
                    }),
                ).toBe(true);
            });

            it("principal without actsFor cannot impersonate", async () => {
                const manage = await rbac.createPermission(ctx, "user.manage");
                const adminRole = await rbac.createRole(ctx, { roleName: "Admin", tenantId: null });
                await rbac.addPermissionToRole(ctx, adminRole.iri, manage.iri);
                await rbac.grant(ctx, { principalIri: ALICE, roleIri: adminRole.iri });

                // BOB has no actsFor Alice
                expect(
                    await rbac.can(ctx, {
                        principal: BOB,
                        permission: "user.manage",
                        actingAs: ALICE,
                    }),
                ).toBe(false);
            });

            it("revoking actsFor removes impersonation", async () => {
                const perm = await rbac.createPermission(ctx, "secret.read");
                const role = await rbac.createRole(ctx, {
                    roleName: "SecretReader",
                    tenantId: null,
                });
                await rbac.addPermissionToRole(ctx, role.iri, perm.iri);
                await rbac.grant(ctx, { principalIri: ALICE, roleIri: role.iri });

                const agent = await rbac.createServiceAccount(ctx, {
                    serviceAccountName: "agent",
                    serviceAccountToken: "tok",
                    tenantId: null,
                });
                await rbac.allowImpersonation(ctx, agent.iri, ALICE);
                expect(
                    await rbac.can(ctx, {
                        principal: agent.iri,
                        permission: "secret.read",
                        actingAs: ALICE,
                    }),
                ).toBe(true);

                await rbac.revokeImpersonation(ctx, agent.iri, ALICE);
                expect(
                    await rbac.can(ctx, {
                        principal: agent.iri,
                        permission: "secret.read",
                        actingAs: ALICE,
                    }),
                ).toBe(false);
            });
        });

        // ── Service accounts ──────────────────────────────────────────────────

        describe("service accounts", () => {
            it("service account can be granted a role directly", async () => {
                const read = await rbac.createPermission(ctx, "api.read");
                const role = await rbac.createRole(ctx, { roleName: "APIReader", tenantId: null });
                await rbac.addPermissionToRole(ctx, role.iri, read.iri);

                const sa = await rbac.createServiceAccount(ctx, {
                    serviceAccountName: "data-sync",
                    serviceAccountToken: "sync-token",
                    tenantId: null,
                });
                await rbac.grant(ctx, { principalIri: sa.iri, roleIri: role.iri });

                expect(await rbac.can(ctx, { principal: sa.iri, permission: "api.read" })).toBe(
                    true,
                );
            });

            it("service account can be a member of a group", async () => {
                const write = await rbac.createPermission(ctx, "data.write");
                const role = await rbac.createRole(ctx, { roleName: "DataWriter", tenantId: null });
                await rbac.addPermissionToRole(ctx, role.iri, write.iri);
                const group = await rbac.createUserGroup(ctx, {
                    groupName: "Writers",
                    tenantId: null,
                });
                await rbac.grant(ctx, { principalIri: group.iri, roleIri: role.iri });

                const sa = await rbac.createServiceAccount(ctx, {
                    serviceAccountName: "writer-bot",
                    serviceAccountToken: "tok",
                    tenantId: null,
                });
                await rbac.addMember(ctx, group.iri, sa.iri);

                expect(await rbac.can(ctx, { principal: sa.iri, permission: "data.write" })).toBe(
                    true,
                );
            });
        });

        // ── Tenant isolation ──────────────────────────────────────────────────

        describe("tenant isolation", () => {
            it("grant scoped to tenant A does not apply in tenant B", async () => {
                const read = await rbac.createPermission(ctx, "project.read");
                const role = await rbac.createRole(ctx, { roleName: "Reader", tenantId: null });
                await rbac.addPermissionToRole(ctx, role.iri, read.iri);

                const acme = await rbac.createTenant(ctx, "Acme Corp");
                const globex = await rbac.createTenant(ctx, "Globex Corp");

                const acmeProject = await rbac.createResource(ctx, {
                    resourceType: "project",
                    tenantId: acme.id,
                });
                const globexProject = await rbac.createResource(ctx, {
                    resourceType: "project",
                    tenantId: globex.id,
                });

                // Grant Alice only in Acme's project
                await rbac.grant(ctx, {
                    principalIri: ALICE,
                    roleIri: role.iri,
                    scopeIri: acmeProject.iri,
                });

                expect(
                    await rbac.can(ctx, {
                        principal: ALICE,
                        permission: "project.read",
                        scope: acmeProject.iri,
                    }),
                ).toBe(true);
                expect(
                    await rbac.can(ctx, {
                        principal: ALICE,
                        permission: "project.read",
                        scope: globexProject.iri,
                    }),
                ).toBe(false);
            });

            it("Dave (Globex user) cannot access Acme resources", async () => {
                const read = await rbac.createPermission(ctx, "project.read");
                const role = await rbac.createRole(ctx, { roleName: "Reader", tenantId: null });
                await rbac.addPermissionToRole(ctx, role.iri, read.iri);

                const acme = await rbac.createTenant(ctx, "Acme Corp");
                const acmeProject = await rbac.createResource(ctx, {
                    resourceType: "project",
                    tenantId: acme.id,
                });

                // Only Alice is granted in Acme
                await rbac.grant(ctx, {
                    principalIri: ALICE,
                    roleIri: role.iri,
                    scopeIri: acmeProject.iri,
                });

                expect(
                    await rbac.can(ctx, {
                        principal: DAVE,
                        permission: "project.read",
                        scope: acmeProject.iri,
                    }),
                ).toBe(false);
            });
        });

        // ── Direct permission grants ──────────────────────────────────────────

        describe("direct permission grants (no role)", () => {
            it("principal can be granted a permission directly without a role", async () => {
                const perm = await rbac.createPermission(ctx, "special.action");
                await rbac.grant(ctx, { principalIri: ALICE, permissionIri: perm.iri });

                expect(
                    await rbac.can(ctx, { principal: ALICE, permission: "special.action" }),
                ).toBe(true);
            });
        });

        // ── Delegation chain ──────────────────────────────────────────────────

        describe("delegation chain", () => {
            it("delegatedFrom tracks the originating grant", async () => {
                const perm = await rbac.createPermission(ctx, "resource.edit");
                const role = await rbac.createRole(ctx, { roleName: "Editor", tenantId: null });
                await rbac.addPermissionToRole(ctx, role.iri, perm.iri);

                const source = await rbac.grant(ctx, { principalIri: ALICE, roleIri: role.iri });
                const delegated = await rbac.grant(ctx, {
                    principalIri: BOB,
                    roleIri: role.iri,
                    grantedByIri: ALICE,
                    delegatedFromIri: source.iri,
                });

                expect(delegated.delegatedFromIri).toBe(source.iri);
                expect(delegated.grantedByIri).toBe(ALICE);
                expect(await rbac.can(ctx, { principal: BOB, permission: "resource.edit" })).toBe(
                    true,
                );
            });
        });

        // ── RbacService façade ────────────────────────────────────────────────

        describe("RbacService façade", () => {
            it("assert() resolves when principal is allowed", async () => {
                const perm = await rbac.createPermission(ctx, "docs.read");
                const role = await rbac.createRole(ctx, { roleName: "Viewer", tenantId: null });
                await rbac.addPermissionToRole(ctx, role.iri, perm.iri);
                await rbac.grant(ctx, { principalIri: ALICE, roleIri: role.iri });

                await expect(
                    rbac.assert(ctx, { principal: ALICE, permission: "docs.read" }),
                ).resolves.toBeUndefined();
            });

            it("assert() throws when principal is denied", async () => {
                await expect(
                    rbac.assert(ctx, { principal: BOB, permission: "docs.read" }),
                ).rejects.toThrow(/Access denied/);
            });

            it("assert() error message names the principal and permission", async () => {
                const err = await rbac
                    .assert(ctx, { principal: BOB, permission: "billing.write" })
                    .catch((e: Error) => e);
                expect((err as Error).message).toContain("billing.write");
                expect((err as Error).message).toContain(BOB);
            });

            it("can() never throws — returns false on denial", async () => {
                await expect(
                    rbac.can(ctx, { principal: "http://nobody", permission: "anything" }),
                ).resolves.toBe(false);
            });
        });

        // ── AccessChecker standalone ──────────────────────────────────────────

        describe("AccessChecker standalone", () => {
            it("can be used directly without RbacService", async () => {
                const grants = new PolicyGrantRepository(store);
                const permissions = new PermissionRepository(store);
                const roles = new RoleRepository(store);
                const checker = new AccessChecker(store, grants);

                const perm = await permissions.create(ctx, { permissionKey: "raw.check" });
                const role = await roles.create(ctx, { roleName: "Raw", tenantId: null });
                await roles.addPermission(ctx, role.iri, perm.iri);
                await grants.create(ctx, { principalIri: ALICE, roleIri: role.iri });

                const result = await checker.check(ctx, {
                    principal: ALICE,
                    permission: "raw.check",
                });
                expect(result).toBe(true);
            });
        });

        // ── Full real-world scenario: Acme project collaboration ─────────────

        describe("full scenario: Acme project collaboration", () => {
            it("complete multi-user, multi-role, scoped access scenario", async () => {
                // ── Permissions ───────────────────────────────────────────────
                const projRead = await rbac.createPermission(ctx, "project.read");
                const projWrite = await rbac.createPermission(ctx, "project.write");
                const projDelete = await rbac.createPermission(ctx, "project.delete");
                const userManage = await rbac.createPermission(ctx, "user.manage");

                // ── Roles (with inheritance) ───────────────────────────────────
                const viewerRole = await rbac.createRole(ctx, {
                    roleName: "Viewer",
                    tenantId: null,
                });
                await rbac.addPermissionToRole(ctx, viewerRole.iri, projRead.iri);

                const editorRole = await rbac.createRole(ctx, {
                    roleName: "Editor",
                    tenantId: null,
                });
                await rbac.addPermissionToRole(ctx, editorRole.iri, projWrite.iri);
                await rbac.addRoleInheritance(ctx, editorRole.iri, viewerRole.iri);

                const ownerRole = await rbac.createRole(ctx, { roleName: "Owner", tenantId: null });
                await rbac.addPermissionToRole(ctx, ownerRole.iri, projDelete.iri);
                await rbac.addPermissionToRole(ctx, ownerRole.iri, userManage.iri);
                await rbac.addRoleInheritance(ctx, ownerRole.iri, editorRole.iri);

                // ── Groups ────────────────────────────────────────────────────
                const acme = await rbac.createTenant(ctx, "Acme Corp");
                const owners = await rbac.createUserGroup(ctx, {
                    groupName: "Owners",
                    tenantId: acme.id,
                });
                const editors = await rbac.createUserGroup(ctx, {
                    groupName: "Editors",
                    tenantId: acme.id,
                });
                const viewers = await rbac.createUserGroup(ctx, {
                    groupName: "Viewers",
                    tenantId: acme.id,
                });

                // ── Grant roles to groups ─────────────────────────────────────
                await rbac.grant(ctx, { principalIri: owners.iri, roleIri: ownerRole.iri });
                await rbac.grant(ctx, { principalIri: editors.iri, roleIri: editorRole.iri });
                await rbac.grant(ctx, { principalIri: viewers.iri, roleIri: viewerRole.iri });

                // ── Assign principals to groups ───────────────────────────────
                await rbac.addMember(ctx, owners.iri, ALICE);
                await rbac.addMember(ctx, editors.iri, BOB);
                await rbac.addMember(ctx, viewers.iri, CHARLIE);

                // ── Resources ─────────────────────────────────────────────────
                const project = await rbac.createResource(ctx, {
                    resourceType: "project",
                    tenantId: acme.id,
                });
                const subfolder = await rbac.createResource(ctx, {
                    resourceType: "folder",
                    parentIri: project.iri,
                });

                // ── Assertions ────────────────────────────────────────────────

                // Alice (owner) can do everything on both project and subfolder
                expect(await rbac.can(ctx, { principal: ALICE, permission: "project.read" })).toBe(
                    true,
                );
                expect(await rbac.can(ctx, { principal: ALICE, permission: "project.write" })).toBe(
                    true,
                );
                expect(
                    await rbac.can(ctx, { principal: ALICE, permission: "project.delete" }),
                ).toBe(true);
                expect(await rbac.can(ctx, { principal: ALICE, permission: "user.manage" })).toBe(
                    true,
                );

                // Bob (editor) can read and write but not delete
                expect(await rbac.can(ctx, { principal: BOB, permission: "project.read" })).toBe(
                    true,
                );
                expect(await rbac.can(ctx, { principal: BOB, permission: "project.write" })).toBe(
                    true,
                );
                expect(await rbac.can(ctx, { principal: BOB, permission: "project.delete" })).toBe(
                    false,
                );
                expect(await rbac.can(ctx, { principal: BOB, permission: "user.manage" })).toBe(
                    false,
                );

                // Charlie (viewer) can only read
                expect(
                    await rbac.can(ctx, { principal: CHARLIE, permission: "project.read" }),
                ).toBe(true);
                expect(
                    await rbac.can(ctx, { principal: CHARLIE, permission: "project.write" }),
                ).toBe(false);

                // Dave (different tenant) can do nothing
                expect(await rbac.can(ctx, { principal: DAVE, permission: "project.read" })).toBe(
                    false,
                );

                // Scope chain: grants apply transitively to the subfolder
                await rbac.grant(ctx, {
                    principalIri: owners.iri,
                    roleIri: ownerRole.iri,
                    scopeIri: project.iri,
                });
                expect(
                    await rbac.can(ctx, {
                        principal: ALICE,
                        permission: "project.read",
                        scope: subfolder.iri,
                    }),
                ).toBe(true);

                // Charlie is denied billing even though unrelated role gave it
                const billingRead = await rbac.createPermission(ctx, "billing.read");
                const billingRole = await rbac.createRole(ctx, {
                    roleName: "BillingViewer",
                    tenantId: null,
                });
                await rbac.addPermissionToRole(ctx, billingRole.iri, billingRead.iri);
                await rbac.grant(ctx, { principalIri: viewers.iri, roleIri: billingRole.iri });
                await rbac.grant(ctx, {
                    principalIri: CHARLIE,
                    roleIri: billingRole.iri,
                    isDenial: true,
                });

                expect(
                    await rbac.can(ctx, { principal: CHARLIE, permission: "billing.read" }),
                ).toBe(false);
                expect(await rbac.can(ctx, { principal: BOB, permission: "billing.read" })).toBe(
                    false,
                ); // not in viewers

                // Temporary access for Charlie to write on the project
                const tempExpiry = new Date(Date.now() + 60_000);
                await rbac.grant(ctx, {
                    principalIri: CHARLIE,
                    roleIri: editorRole.iri,
                    scopeIri: project.iri,
                    grantExpiresAt: tempExpiry,
                });
                expect(
                    await rbac.can(ctx, {
                        principal: CHARLIE,
                        permission: "project.write",
                        scope: project.iri,
                    }),
                ).toBe(true);
                expect(
                    await rbac.can(ctx, { principal: CHARLIE, permission: "project.write" }),
                ).toBe(false); // no scope = denied
            });
        });
    });
}

// ── Migration down() ──────────────────────────────────────────────────────────

describe("migration 004 down()", () => {
    it("soft-deletes all RBAC edges and leaves a clean slate for re-migration", async () => {
        const { up, down } = await import("../../../data/src/migrations/004_rbac.js");
        const knex = await createDataContext({ client: "sqlite", filename: ":memory:" });
        await up(knex);

        // After down() all RBAC edges are soft-deleted — the checker finds nothing
        await down(knex);

        const store = new TripleStore(knex);
        const grants = new PolicyGrantRepository(store);
        const checker = new AccessChecker(store, grants);
        const allowed = await checker.check(defaultServerContext, {
            principal: ALICE,
            permission: "anything",
        });
        expect(allowed).toBe(false);

        // Re-seeding after down() completes without error (idempotent restore)
        await expect(up(knex)).resolves.toBeUndefined();

        await knex.destroy();
    });
});
