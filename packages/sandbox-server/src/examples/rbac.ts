/**
 * RBAC sandbox — runnable developer walkthrough.
 *
 * Demonstrates every major feature of the @jasonscharf/rbac package using an
 * in-memory SQLite database.  Run with:
 *
 *   yarn workspace @jasonscharf/sandbox-rbac start
 *
 * Output is structured so you can follow along section by section.
 */

import { createDataContext, TripleStore } from "@jasonscharf/data";
import {
    PermissionRepository,
    PolicyGrantRepository,
    RbacService,
    ResourceNodeRepository,
    RoleRepository,
    ServiceAccountRepository,
    SYS_SUPERUSERS_IRI,
    seedSystemData,
    TenantRepository,
    UserGroupRepository,
} from "@jasonscharf/rbac";
import { buildServerContext, type SecurityContext, systemSec } from "@jasonscharf/server";

// ── Helpers ───────────────────────────────────────────────────────────────────

function section(title: string) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`  ${title}`);
    console.log("─".repeat(60));
}

function ok(label: string, value: boolean) {
    const icon = value ? "✓" : "✗";
    const color = value ? "\x1b[32m" : "\x1b[31m";
    console.log(`  ${color}${icon}\x1b[0m  ${label}: ${value}`);
}

function secFor(principalIri: string): SecurityContext {
    return {
        principalIri,
        sessionId: null,
        sessionToken: null,
        isImpersonating: false,
    };
}

function secActingAs(principalIri: string, actingAsIri: string): SecurityContext {
    return {
        principalIri,
        sessionId: null,
        sessionToken: null,
        isImpersonating: true,
        actingAsIri,
    };
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const knex = await createDataContext({ client: "sqlite", filename: ":memory:" });
const store = new TripleStore(knex);
const ctx = buildServerContext(store);
await seedSystemData(ctx, store); // installs system root tenant, superusers group, wildcard

const rbac = new RbacService({
    store,
    tenants: new TenantRepository(store),
    groups: new UserGroupRepository(store),
    roles: new RoleRepository(store),
    grants: new PolicyGrantRepository(store),
    permissions: new PermissionRepository(store),
    resources: new ResourceNodeRepository(store),
    serviceAccounts: new ServiceAccountRepository(store),
});

// ── 1. Tenants ────────────────────────────────────────────────────────────────

section("1. Tenants");

const acme = await rbac.createTenant(ctx, systemSec, { name: "Acme Corp" });
await rbac.createTenant(ctx, systemSec, { name: "Globex Corp" });

console.log(`  Created tenant: ${acme.tenantName} (${acme.id})`);
console.log("  Created tenant: Globex Corp (dave's tenant — no Acme grants)");

// ── 2. Permissions ────────────────────────────────────────────────────────────

section("2. Permissions");

const projRead = await rbac.createPermission(ctx, systemSec, { key: "project.read" });
const projWrite = await rbac.createPermission(ctx, systemSec, { key: "project.write" });
const projDelete = await rbac.createPermission(ctx, systemSec, { key: "project.delete" });
const userManage = await rbac.createPermission(ctx, systemSec, { key: "user.manage" });
const billingRead = await rbac.createPermission(ctx, systemSec, { key: "billing.read" });
const billingWrite = await rbac.createPermission(ctx, systemSec, { key: "billing.write" });

console.log(
    "  Permissions registered:",
    [projRead, projWrite, projDelete, userManage, billingRead, billingWrite]
        .map((p) => p.permissionKey)
        .join(", "),
);

// ── 3. Roles with inheritance ─────────────────────────────────────────────────

section("3. Roles with inheritance");

//  Viewer  ←──── Editor  ←──── Owner
//  (read)       (+write)       (+delete, user.manage)

const viewerRole = await rbac.createRole(ctx, systemSec, { roleName: "Viewer", tenantId: acme.id });
await rbac.addPermissionToRole(ctx, systemSec, { roleIri: viewerRole.iri, permissionIri: projRead.iri });
await rbac.addPermissionToRole(ctx, systemSec, {
    roleIri: viewerRole.iri,
    permissionIri: billingRead.iri,
});

const editorRole = await rbac.createRole(ctx, systemSec, { roleName: "Editor", tenantId: acme.id });
await rbac.addPermissionToRole(ctx, systemSec, {
    roleIri: editorRole.iri,
    permissionIri: projWrite.iri,
});
await rbac.addRoleInheritance(ctx, systemSec, {
    childRoleIri: editorRole.iri,
    parentRoleIri: viewerRole.iri,
});

const ownerRole = await rbac.createRole(ctx, systemSec, { roleName: "Owner", tenantId: acme.id });
await rbac.addPermissionToRole(ctx, systemSec, {
    roleIri: ownerRole.iri,
    permissionIri: projDelete.iri,
});
await rbac.addPermissionToRole(ctx, systemSec, {
    roleIri: ownerRole.iri,
    permissionIri: userManage.iri,
});
await rbac.addPermissionToRole(ctx, systemSec, {
    roleIri: ownerRole.iri,
    permissionIri: billingWrite.iri,
});
await rbac.addRoleInheritance(ctx, systemSec, {
    childRoleIri: ownerRole.iri,
    parentRoleIri: editorRole.iri,
});

console.log("  Viewer  → project.read, billing.read");
console.log("  Editor  → project.write  (+ inherits Viewer)");
console.log("  Owner   → project.delete, user.manage, billing.write  (+ inherits Editor)");

// ── 4. Groups and membership ──────────────────────────────────────────────────

section("4. Groups and membership");

const ownersGroup = await rbac.createUserGroup(ctx, systemSec, {
    groupName: "Owners",
    tenantId: acme.id,
});
const editorsGroup = await rbac.createUserGroup(ctx, systemSec, {
    groupName: "Editors",
    tenantId: acme.id,
});
const viewersGroup = await rbac.createUserGroup(ctx, systemSec, {
    groupName: "Viewers",
    tenantId: acme.id,
});

await rbac.grant(ctx, systemSec, { principalIri: ownersGroup.iri, roleIri: ownerRole.iri });
await rbac.grant(ctx, systemSec, { principalIri: editorsGroup.iri, roleIri: editorRole.iri });
await rbac.grant(ctx, systemSec, { principalIri: viewersGroup.iri, roleIri: viewerRole.iri });

// Synthetic user IRIs
const alice = "http://tern.dev/ns/auth/user/alice";
const bob = "http://tern.dev/ns/auth/user/bob";
const charlie = "http://tern.dev/ns/auth/user/charlie";
const dave = "http://tern.dev/ns/auth/user/dave";

await rbac.addMember(ctx, systemSec, { groupIri: ownersGroup.iri, memberIri: alice });
await rbac.addMember(ctx, systemSec, { groupIri: editorsGroup.iri, memberIri: bob });
await rbac.addMember(ctx, systemSec, { groupIri: viewersGroup.iri, memberIri: charlie });

console.log("  alice  → Owners group");
console.log("  bob    → Editors group");
console.log("  charlie → Viewers group");
console.log("  dave   → (Globex — no Acme group membership)");

// ── 5. Basic permission checks ────────────────────────────────────────────────

section("5. Basic permission checks");

ok(
    "alice  can project.delete (owner)",
    await rbac.can(ctx, secFor(alice), { permission: "project.delete" }),
);
ok(
    "alice  can project.read   (inherited)",
    await rbac.can(ctx, secFor(alice), { permission: "project.read" }),
);
ok(
    "bob    can project.write  (editor)",
    await rbac.can(ctx, secFor(bob), { permission: "project.write" }),
);
ok(
    "bob    can project.read   (inherited from viewer)",
    await rbac.can(ctx, secFor(bob), { permission: "project.read" }),
);
ok(
    "bob    cannot project.delete",
    !(await rbac.can(ctx, secFor(bob), { permission: "project.delete" })),
);
ok(
    "charlie can project.read (viewer)",
    await rbac.can(ctx, secFor(charlie), { permission: "project.read" }),
);
ok(
    "charlie cannot project.write",
    !(await rbac.can(ctx, secFor(charlie), { permission: "project.write" })),
);
ok(
    "dave   cannot anything    (wrong tenant)",
    !(await rbac.can(ctx, secFor(dave), { permission: "project.read" })),
);

// ── 6. Resource-level scoping ─────────────────────────────────────────────────

section("6. Resource-level scoping");

const projectAlpha = await rbac.createResource(ctx, systemSec, {
    resourceType: "project",
    tenantId: acme.id,
});
const projectBeta = await rbac.createResource(ctx, systemSec, {
    resourceType: "project",
    tenantId: acme.id,
});

await rbac.grant(ctx, systemSec, {
    principalIri: charlie,
    roleIri: editorRole.iri,
    scopeIri: projectAlpha.iri,
});

ok(
    "charlie can  project.write on alpha (scoped grant)",
    await rbac.can(ctx, secFor(charlie), {
        permission: "project.write",
        scope: projectAlpha.iri,
    }),
);
ok(
    "charlie cannot project.write on beta (different resource)",
    !(await rbac.can(ctx, secFor(charlie), {
        permission: "project.write",
        scope: projectBeta.iri,
    })),
);
ok(
    "charlie cannot project.write globally",
    !(await rbac.can(ctx, secFor(charlie), { permission: "project.write" })),
);

// ── 7. Resource hierarchy ─────────────────────────────────────────────────────

section("7. Resource hierarchy");

const folder = await rbac.createResource(ctx, systemSec, {
    resourceType: "folder",
    parentIri: projectAlpha.iri,
});
const file = await rbac.createResource(ctx, systemSec, {
    resourceType: "file",
    parentIri: folder.iri,
});

ok(
    "charlie can  project.write on folder (child of alpha)",
    await rbac.can(ctx, secFor(charlie), { permission: "project.write", scope: folder.iri }),
);
ok(
    "charlie can  project.write on file   (grandchild of alpha)",
    await rbac.can(ctx, secFor(charlie), { permission: "project.write", scope: file.iri }),
);

// ── 8. Temporary grants ───────────────────────────────────────────────────────

section("8. Temporary grants");

const tempPerm = await rbac.createPermission(ctx, systemSec, { key: "deploy.trigger" });
const deployRole = await rbac.createRole(ctx, systemSec, { roleName: "Deployer", tenantId: null });
await rbac.addPermissionToRole(ctx, systemSec, {
    roleIri: deployRole.iri,
    permissionIri: tempPerm.iri,
});

const futureExpiry = new Date(Date.now() + 30 * 60_000);
await rbac.grant(ctx, systemSec, {
    principalIri: bob,
    roleIri: deployRole.iri,
    grantExpiresAt: futureExpiry,
});
ok(
    "bob    can  deploy.trigger (30-min grant)",
    await rbac.can(ctx, secFor(bob), { permission: "deploy.trigger" }),
);

const pastExpiry = new Date(Date.now() - 1);
const expiredGrant = await rbac.grant(ctx, systemSec, {
    principalIri: charlie,
    roleIri: deployRole.iri,
    grantExpiresAt: pastExpiry,
});
ok(
    "charlie cannot deploy.trigger (expired grant)",
    !(await rbac.can(ctx, secFor(charlie), { permission: "deploy.trigger" })),
);

const aliveGrant = await rbac.grant(ctx, systemSec, { principalIri: dave, roleIri: deployRole.iri });
ok(
    "dave   can  deploy.trigger (active grant)",
    await rbac.can(ctx, secFor(dave), { permission: "deploy.trigger" }),
);
await rbac.revoke(ctx, systemSec, { grantIri: aliveGrant.iri });
ok(
    "dave   cannot deploy.trigger (grant revoked)",
    !(await rbac.can(ctx, secFor(dave), { permission: "deploy.trigger" })),
);

void expiredGrant;

// ── 9. Explicit denials ───────────────────────────────────────────────────────

section("9. Explicit denials");

ok(
    "charlie can  billing.read before denial",
    await rbac.can(ctx, secFor(charlie), { permission: "billing.read" }),
);

await rbac.grant(ctx, systemSec, {
    principalIri: charlie,
    roleIri: viewerRole.iri,
    isDenial: true,
});

ok(
    "charlie cannot billing.read after denial (overrides group allow)",
    !(await rbac.can(ctx, secFor(charlie), { permission: "billing.read" })),
);
ok(
    "bob    can  billing.read  (denial only targets charlie)",
    await rbac.can(ctx, secFor(bob), { permission: "billing.read" }),
);

// ── 10. Impersonation ─────────────────────────────────────────────────────────

section("10. Impersonation");

const agent = await rbac.createServiceAccount(ctx, systemSec, {
    serviceAccountName: "deploy-agent",
    serviceAccountToken: "super-secret-token",
    tenantId: acme.id,
});

ok(
    "agent  cannot user.manage (no direct permissions)",
    !(await rbac.can(ctx, secFor(agent.iri), { permission: "user.manage" })),
);

await rbac.allowImpersonation(ctx, systemSec, { fromIri: agent.iri, toIri: alice });

ok(
    "agent  can  user.manage  acting as alice",
    await rbac.can(ctx, secActingAs(agent.iri, alice), { permission: "user.manage" }),
);
ok(
    "agent  cannot user.manage acting as bob (not granted)",
    !(await rbac.can(ctx, secActingAs(agent.iri, bob), { permission: "user.manage" })),
);

await rbac.revokeImpersonation(ctx, systemSec, { fromIri: agent.iri, toIri: alice });
ok(
    "agent  cannot user.manage after revoking impersonation",
    !(await rbac.can(ctx, secActingAs(agent.iri, alice), { permission: "user.manage" })),
);

// ── 11. Service accounts ──────────────────────────────────────────────────────

section("11. Service accounts");

const syncBot = await rbac.createServiceAccount(ctx, systemSec, {
    serviceAccountName: "sync-bot",
    serviceAccountToken: "sync-secret",
    tenantId: acme.id,
});
const apiReadPerm = await rbac.createPermission(ctx, systemSec, { key: "api.read" });
const apiRole = await rbac.createRole(ctx, systemSec, { roleName: "APIReader", tenantId: null });
await rbac.addPermissionToRole(ctx, systemSec, {
    roleIri: apiRole.iri,
    permissionIri: apiReadPerm.iri,
});
await rbac.grant(ctx, systemSec, { principalIri: syncBot.iri, roleIri: apiRole.iri });

ok(
    "sync-bot can  api.read",
    await rbac.can(ctx, secFor(syncBot.iri), { permission: "api.read" }),
);

await rbac.addMember(ctx, systemSec, { groupIri: editorsGroup.iri, memberIri: syncBot.iri });
ok(
    "sync-bot can  project.write (via Editors group)",
    await rbac.can(ctx, secFor(syncBot.iri), { permission: "project.write" }),
);

// ── 12. Superusers ────────────────────────────────────────────────────────────

section("12. Superusers (system wildcard)");

const superAdmin = "http://tern.dev/ns/auth/user/super-admin";
ok(
    "superAdmin cannot anything before being added to superusers",
    !(await rbac.can(ctx, secFor(superAdmin), { permission: "billing.delete" })),
);

await rbac.addMember(ctx, systemSec, { groupIri: SYS_SUPERUSERS_IRI, memberIri: superAdmin });
ok(
    "superAdmin can  billing.delete (wildcard via superusers)",
    await rbac.can(ctx, secFor(superAdmin), { permission: "billing.delete" }),
);
ok(
    "superAdmin can  any.invented.permission",
    await rbac.can(ctx, secFor(superAdmin), { permission: "any.invented.permission" }),
);

const allPerms = await rbac.resolvePermissions(ctx, secFor(superAdmin), {});
ok("resolvePermissions includes '*' for superuser", allPerms.has("*"));

// ── 13. assert() and resolvePermissions() ─────────────────────────────────────

section("13. assert() and resolvePermissions()");

await rbac.assert(ctx, secFor(alice), { permission: "project.delete" });
console.log("  alice assert(project.delete) → resolved silently ✓");

try {
    await rbac.assert(ctx, secFor(dave), { permission: "project.delete" });
} catch (err) {
    console.log(`  dave  assert(project.delete) → threw: ${(err as Error).message}`);
}

const alicePerms = await rbac.resolvePermissions(ctx, secFor(alice), {});
console.log(`  alice's effective permissions: [${[...alicePerms].sort().join(", ")}]`);

const charliePerms = await rbac.resolvePermissions(ctx, secFor(charlie), {});
console.log(
    `  charlie's effective permissions (with scoped grant excluded): [${[...charliePerms].sort().join(", ")}]`,
);

// ── 14. UserGroup CRUD ────────────────────────────────────────────────────────

section("14. UserGroup CRUD");

const foundEng = await rbac.findUserGroupByName(ctx, systemSec, { name: "Editors", tenantId: acme.id });
console.log(`  findUserGroupByName("Editors") → ${foundEng?.groupName ?? "null"}`);

const allGroups = await rbac.listUserGroups(ctx, systemSec, { tenantId: acme.id });
console.log(`  listUserGroups(acme) → [${allGroups.map((g) => g.groupName).join(", ")}]`);

const tempGroup = await rbac.createUserGroup(ctx, systemSec, {
    groupName: "OldName",
    tenantId: acme.id,
});
await rbac.updateUserGroup(ctx, systemSec, { id: tempGroup.id, patch: { groupName: "NewName" } });
const renamed = await rbac.getUserGroup(ctx, systemSec, { id: tempGroup.id });
console.log(`  updateUserGroup: "OldName" → "${renamed?.groupName}"`);

await rbac.addMember(ctx, systemSec, { groupIri: tempGroup.iri, memberIri: dave });
await rbac.deleteUserGroup(ctx, systemSec, { id: tempGroup.id });
const afterDelete = await rbac.getUserGroup(ctx, systemSec, { id: tempGroup.id });
const membersAfterDelete = await rbac.listMembers(ctx, systemSec, { groupIri: tempGroup.iri });
console.log(
    `  deleteUserGroup: group exists? ${afterDelete !== null}, members left: ${membersAfterDelete.length}`,
);

// ── 15. Inspector cheatsheet ──────────────────────────────────────────────────

section("15. Inspector cheatsheet");

const inspect = rbac.inspector();

const effectiveAlice = await inspect.listEffectivePermissions(ctx, systemSec, {
    principalIri: alice,
});
console.log(`  listEffectivePermissions(alice): [${[...effectiveAlice].sort().join(", ")}]`);

const explanation = await inspect.explain(ctx, systemSec, {
    principal: alice,
    permission: "project.delete",
});
console.log(`\n  explain(alice, "project.delete"):`);
console.log(`    allowed:     ${explanation.allowed}`);
for (const path of explanation.allowedBy) {
    const via =
        path.membershipChain.length > 0
            ? ` via group chain [${path.membershipChain.length} hop(s)]`
            : " directly";
    const inherited =
        path.roleInheritanceChain.length > 0
            ? ` (inherits through ${path.roleInheritanceChain.length} role(s))`
            : "";
    console.log(`    allowedBy:   role "${path.roleName}"${via}${inherited}`);
}

const denialExplain = await inspect.explain(ctx, systemSec, {
    principal: charlie,
    permission: "billing.read",
});
console.log(`\n  explain(charlie, "billing.read"):`);
console.log(`    allowed:     ${denialExplain.allowed}`);
console.log(
    `    deniedBy:    ${denialExplain.deniedBy.length} path(s), allowedBy: ${denialExplain.allowedBy.length} path(s)`,
);

const noAccess = await inspect.explain(ctx, systemSec, {
    principal: dave,
    permission: "project.delete",
});
console.log(`\n  explain(dave, "project.delete"):`);
console.log(`    allowed: ${noAccess.allowed}, paths: ${noAccess.allowedBy.length}`);

const aliceDirect = await inspect.listGroupMemberships(ctx, systemSec, { principalIri: alice });
console.log(
    `\n  listGroupMemberships(alice, direct): [${aliceDirect.map((g) => g.groupName).join(", ")}]`,
);

const outerGroup = await rbac.createUserGroup(ctx, systemSec, {
    groupName: "OuterTeam",
    tenantId: acme.id,
});
const innerGroup = await rbac.createUserGroup(ctx, systemSec, {
    groupName: "InnerTeam",
    tenantId: acme.id,
});
await rbac.addMember(ctx, systemSec, { groupIri: outerGroup.iri, memberIri: innerGroup.iri });
await rbac.addMember(ctx, systemSec, { groupIri: innerGroup.iri, memberIri: bob });

const bobTransitive = await inspect.listGroupMemberships(ctx, systemSec, {
    principalIri: bob,
    transitive: true,
});
console.log(
    `  listGroupMemberships(bob, transitive): [${bobTransitive.map((g) => g.groupName).join(", ")}]`,
);

const outerMembers = await inspect.listGroupMembers(ctx, systemSec, {
    groupIri: outerGroup.iri,
    transitive: true,
});
console.log(
    `  listGroupMembers(OuterTeam, transitive): bob in list? ${outerMembers.includes(bob)}`,
);

const withMembers = await inspect.listGroupsWithMembers(ctx, systemSec, { tenantId: acme.id });
console.log(`\n  listGroupsWithMembers(acme):`);
for (const g of withMembers.filter((g) => g.members.length > 0)) {
    console.log(`    ${g.groupName}: ${g.members.length} member(s)`);
}

// ── Done ──────────────────────────────────────────────────────────────────────

section("Done");
console.log("  All examples completed.\n");
await knex.destroy();
