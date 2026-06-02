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
import { defaultServerContext } from "@jasonscharf/server";

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

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const knex = await createDataContext({ client: "sqlite", filename: ":memory:" });
const store = new TripleStore(knex);
const ctx = defaultServerContext;
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

const acme = await rbac.createTenant(ctx, "Acme Corp");
await rbac.createTenant(ctx, "Globex Corp"); // dave's tenant — kept separate for isolation demo

console.log(`  Created tenant: ${acme.tenantName} (${acme.id})`);
console.log("  Created tenant: Globex Corp (dave's tenant — no Acme grants)");

// ── 2. Permissions ────────────────────────────────────────────────────────────

section("2. Permissions");

const projRead = await rbac.createPermission(ctx, "project.read");
const projWrite = await rbac.createPermission(ctx, "project.write");
const projDelete = await rbac.createPermission(ctx, "project.delete");
const userManage = await rbac.createPermission(ctx, "user.manage");
const billingRead = await rbac.createPermission(ctx, "billing.read");
const billingWrite = await rbac.createPermission(ctx, "billing.write");

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

const viewerRole = await rbac.createRole(ctx, { roleName: "Viewer", tenantId: acme.id });
await rbac.addPermissionToRole(ctx, viewerRole.iri, projRead.iri);
await rbac.addPermissionToRole(ctx, viewerRole.iri, billingRead.iri);

const editorRole = await rbac.createRole(ctx, { roleName: "Editor", tenantId: acme.id });
await rbac.addPermissionToRole(ctx, editorRole.iri, projWrite.iri);
await rbac.addRoleInheritance(ctx, editorRole.iri, viewerRole.iri); // Editor inherits Viewer

const ownerRole = await rbac.createRole(ctx, { roleName: "Owner", tenantId: acme.id });
await rbac.addPermissionToRole(ctx, ownerRole.iri, projDelete.iri);
await rbac.addPermissionToRole(ctx, ownerRole.iri, userManage.iri);
await rbac.addPermissionToRole(ctx, ownerRole.iri, billingWrite.iri);
await rbac.addRoleInheritance(ctx, ownerRole.iri, editorRole.iri); // Owner inherits Editor

console.log("  Viewer  → project.read, billing.read");
console.log("  Editor  → project.write  (+ inherits Viewer)");
console.log("  Owner   → project.delete, user.manage, billing.write  (+ inherits Editor)");

// ── 4. Groups and membership ──────────────────────────────────────────────────

section("4. Groups and membership");

const ownersGroup = await rbac.createUserGroup(ctx, { groupName: "Owners", tenantId: acme.id });
const editorsGroup = await rbac.createUserGroup(ctx, { groupName: "Editors", tenantId: acme.id });
const viewersGroup = await rbac.createUserGroup(ctx, { groupName: "Viewers", tenantId: acme.id });

// Grant a role to each group (system-wide within Acme — no scope restriction)
await rbac.grant(ctx, { principalIri: ownersGroup.iri, roleIri: ownerRole.iri });
await rbac.grant(ctx, { principalIri: editorsGroup.iri, roleIri: editorRole.iri });
await rbac.grant(ctx, { principalIri: viewersGroup.iri, roleIri: viewerRole.iri });

// Synthetic user IRIs (would normally come from auth:User nodes)
const alice = "http://tern.dev/ns/auth/user/alice";
const bob = "http://tern.dev/ns/auth/user/bob";
const charlie = "http://tern.dev/ns/auth/user/charlie";
const dave = "http://tern.dev/ns/auth/user/dave"; // in Globex — no Acme access

await rbac.addMember(ctx, ownersGroup.iri, alice);
await rbac.addMember(ctx, editorsGroup.iri, bob);
await rbac.addMember(ctx, viewersGroup.iri, charlie);

console.log("  alice  → Owners group");
console.log("  bob    → Editors group");
console.log("  charlie → Viewers group");
console.log("  dave   → (Globex — no Acme group membership)");

// ── 5. Basic permission checks ────────────────────────────────────────────────

section("5. Basic permission checks");

ok(
    "alice  can project.delete (owner)",
    await rbac.can(ctx, { principal: alice, permission: "project.delete" }),
);
ok(
    "alice  can project.read   (inherited)",
    await rbac.can(ctx, { principal: alice, permission: "project.read" }),
);
ok(
    "bob    can project.write  (editor)",
    await rbac.can(ctx, { principal: bob, permission: "project.write" }),
);
ok(
    "bob    can project.read   (inherited from viewer)",
    await rbac.can(ctx, { principal: bob, permission: "project.read" }),
);
ok(
    "bob    cannot project.delete",
    !(await rbac.can(ctx, { principal: bob, permission: "project.delete" })),
);
ok(
    "charlie can project.read (viewer)",
    await rbac.can(ctx, { principal: charlie, permission: "project.read" }),
);
ok(
    "charlie cannot project.write",
    !(await rbac.can(ctx, { principal: charlie, permission: "project.write" })),
);
ok(
    "dave   cannot anything    (wrong tenant)",
    !(await rbac.can(ctx, { principal: dave, permission: "project.read" })),
);

// ── 6. Resource-level scoping ─────────────────────────────────────────────────

section("6. Resource-level scoping");

const projectAlpha = await rbac.createResource(ctx, { resourceType: "project", tenantId: acme.id });
const projectBeta = await rbac.createResource(ctx, { resourceType: "project", tenantId: acme.id });

// Grant Charlie write access to alpha only
await rbac.grant(ctx, {
    principalIri: charlie,
    roleIri: editorRole.iri,
    scopeIri: projectAlpha.iri,
});

ok(
    "charlie can  project.write on alpha (scoped grant)",
    await rbac.can(ctx, {
        principal: charlie,
        permission: "project.write",
        scope: projectAlpha.iri,
    }),
);
ok(
    "charlie cannot project.write on beta (different resource)",
    !(await rbac.can(ctx, {
        principal: charlie,
        permission: "project.write",
        scope: projectBeta.iri,
    })),
);
ok(
    "charlie cannot project.write globally",
    !(await rbac.can(ctx, { principal: charlie, permission: "project.write" })),
);

// ── 7. Resource hierarchy (parent scope propagates to children) ───────────────

section("7. Resource hierarchy");

const folder = await rbac.createResource(ctx, {
    resourceType: "folder",
    parentIri: projectAlpha.iri,
});
const file = await rbac.createResource(ctx, { resourceType: "file", parentIri: folder.iri });

// Grant on projectAlpha propagates to folder and file
ok(
    "charlie can  project.write on folder (child of alpha)",
    await rbac.can(ctx, { principal: charlie, permission: "project.write", scope: folder.iri }),
);
ok(
    "charlie can  project.write on file   (grandchild of alpha)",
    await rbac.can(ctx, { principal: charlie, permission: "project.write", scope: file.iri }),
);

// ── 8. Temporary grants ───────────────────────────────────────────────────────

section("8. Temporary grants");

const tempPerm = await rbac.createPermission(ctx, "deploy.trigger");
const deployRole = await rbac.createRole(ctx, { roleName: "Deployer", tenantId: null });
await rbac.addPermissionToRole(ctx, deployRole.iri, tempPerm.iri);

// Grant expires in the future — valid now
const futureExpiry = new Date(Date.now() + 30 * 60_000); // 30 minutes
await rbac.grant(ctx, { principalIri: bob, roleIri: deployRole.iri, grantExpiresAt: futureExpiry });
ok(
    "bob    can  deploy.trigger (30-min grant)",
    await rbac.can(ctx, { principal: bob, permission: "deploy.trigger" }),
);

// Grant already expired — denied
const pastExpiry = new Date(Date.now() - 1);
const expiredGrant = await rbac.grant(ctx, {
    principalIri: charlie,
    roleIri: deployRole.iri,
    grantExpiresAt: pastExpiry,
});
ok(
    "charlie cannot deploy.trigger (expired grant)",
    !(await rbac.can(ctx, { principal: charlie, permission: "deploy.trigger" })),
);

// Revoking a grant
const aliveGrant = await rbac.grant(ctx, { principalIri: dave, roleIri: deployRole.iri });
ok(
    "dave   can  deploy.trigger (active grant)",
    await rbac.can(ctx, { principal: dave, permission: "deploy.trigger" }),
);
await rbac.revoke(ctx, aliveGrant.iri);
ok(
    "dave   cannot deploy.trigger (grant revoked)",
    !(await rbac.can(ctx, { principal: dave, permission: "deploy.trigger" })),
);

// Silence unused-variable warning for expiredGrant
void expiredGrant;

// ── 9. Explicit denials ───────────────────────────────────────────────────────

section("9. Explicit denials");

// Charlie inherits billing.read from Viewers, but we want to block it explicitly
ok(
    "charlie can  billing.read before denial",
    await rbac.can(ctx, { principal: charlie, permission: "billing.read" }),
);

await rbac.grant(ctx, {
    principalIri: charlie,
    roleIri: viewerRole.iri,
    isDenial: true,
});

ok(
    "charlie cannot billing.read after denial (overrides group allow)",
    !(await rbac.can(ctx, { principal: charlie, permission: "billing.read" })),
);
ok(
    "bob    can  billing.read  (denial only targets charlie)",
    await rbac.can(ctx, { principal: bob, permission: "billing.read" }),
);

// ── 10. Impersonation ─────────────────────────────────────────────────────────

section("10. Impersonation");

const agent = await rbac.createServiceAccount(ctx, {
    serviceAccountName: "deploy-agent",
    serviceAccountToken: "super-secret-token",
    tenantId: acme.id,
});

ok(
    "agent  cannot user.manage (no direct permissions)",
    !(await rbac.can(ctx, { principal: agent.iri, permission: "user.manage" })),
);

// Allow the agent to impersonate alice (an owner)
await rbac.allowImpersonation(ctx, agent.iri, alice);

ok(
    "agent  can  user.manage  acting as alice",
    await rbac.can(ctx, { principal: agent.iri, permission: "user.manage", actingAs: alice }),
);
ok(
    "agent  cannot user.manage acting as bob (not granted)",
    !(await rbac.can(ctx, { principal: agent.iri, permission: "user.manage", actingAs: bob })),
);

await rbac.revokeImpersonation(ctx, agent.iri, alice);
ok(
    "agent  cannot user.manage after revoking impersonation",
    !(await rbac.can(ctx, { principal: agent.iri, permission: "user.manage", actingAs: alice })),
);

// ── 11. Service accounts ──────────────────────────────────────────────────────

section("11. Service accounts");

const syncBot = await rbac.createServiceAccount(ctx, {
    serviceAccountName: "sync-bot",
    serviceAccountToken: "sync-secret",
    tenantId: acme.id,
});
const apiReadPerm = await rbac.createPermission(ctx, "api.read");
const apiRole = await rbac.createRole(ctx, { roleName: "APIReader", tenantId: null });
await rbac.addPermissionToRole(ctx, apiRole.iri, apiReadPerm.iri);
await rbac.grant(ctx, { principalIri: syncBot.iri, roleIri: apiRole.iri });

ok(
    "sync-bot can  api.read",
    await rbac.can(ctx, { principal: syncBot.iri, permission: "api.read" }),
);

// Service accounts participate in groups too
await rbac.addMember(ctx, editorsGroup.iri, syncBot.iri);
ok(
    "sync-bot can  project.write (via Editors group)",
    await rbac.can(ctx, { principal: syncBot.iri, permission: "project.write" }),
);

// ── 12. Superusers ────────────────────────────────────────────────────────────

section("12. Superusers (system wildcard)");

const superAdmin = "http://tern.dev/ns/auth/user/super-admin";
ok(
    "superAdmin cannot anything before being added to superusers",
    !(await rbac.can(ctx, { principal: superAdmin, permission: "billing.delete" })),
);

await rbac.addMember(ctx, SYS_SUPERUSERS_IRI, superAdmin);
ok(
    "superAdmin can  billing.delete (wildcard via superusers)",
    await rbac.can(ctx, { principal: superAdmin, permission: "billing.delete" }),
);
ok(
    "superAdmin can  any.invented.permission",
    await rbac.can(ctx, { principal: superAdmin, permission: "any.invented.permission" }),
);

const allPerms = await rbac.resolvePermissions(ctx, superAdmin);
ok("resolvePermissions includes '*' for superuser", allPerms.has("*"));

// ── 13. assert() and resolvePermissions() ─────────────────────────────────────

section("13. assert() and resolvePermissions()");

// assert() resolves silently when allowed
await rbac.assert(ctx, { principal: alice, permission: "project.delete" });
console.log("  alice assert(project.delete) → resolved silently ✓");

// assert() throws a descriptive error when denied
try {
    await rbac.assert(ctx, { principal: dave, permission: "project.delete" });
} catch (err) {
    console.log(`  dave  assert(project.delete) → threw: ${(err as Error).message}`);
}

// resolvePermissions() gives the full effective set
const alicePerms = await rbac.resolvePermissions(ctx, alice);
console.log(`  alice's effective permissions: [${[...alicePerms].sort().join(", ")}]`);

const charliePerms = await rbac.resolvePermissions(ctx, charlie);
console.log(
    `  charlie's effective permissions (with scoped grant excluded): [${[...charliePerms].sort().join(", ")}]`,
);

// ── 14. UserGroup CRUD ────────────────────────────────────────────────────────

section("14. UserGroup CRUD");

// findByName
const foundEng = await rbac.findUserGroupByName(ctx, "Editors", acme.id);
console.log(`  findUserGroupByName("Editors") → ${foundEng?.groupName ?? "null"}`);

// listUserGroups
const allGroups = await rbac.listUserGroups(ctx, acme.id);
console.log(`  listUserGroups(acme) → [${allGroups.map((g) => g.groupName).join(", ")}]`);

// updateUserGroup
const tempGroup = await rbac.createUserGroup(ctx, { groupName: "OldName", tenantId: acme.id });
await rbac.updateUserGroup(ctx, tempGroup.id, { groupName: "NewName" });
const renamed = await rbac.getUserGroup(ctx, tempGroup.id);
console.log(`  updateUserGroup: "OldName" → "${renamed?.groupName}"`);

// deleteUserGroup
await rbac.addMember(ctx, tempGroup.iri, dave);
await rbac.deleteUserGroup(ctx, tempGroup.id);
const afterDelete = await rbac.getUserGroup(ctx, tempGroup.id);
const membersAfterDelete = await rbac.listMembers(ctx, tempGroup.iri);
console.log(
    `  deleteUserGroup: group exists? ${afterDelete !== null}, members left: ${membersAfterDelete.length}`,
);

// ── 15. Inspector cheatsheet ──────────────────────────────────────────────────

section("15. Inspector cheatsheet");

const inspect = rbac.inspector();

// ── List effective permissions
const effectiveAlice = await inspect.listEffectivePermissions(ctx, alice);
console.log(`  listEffectivePermissions(alice): [${[...effectiveAlice].sort().join(", ")}]`);

// ── Explain a permission: why does alice have project.delete?
const explanation = await inspect.explain(ctx, { principal: alice, permission: "project.delete" });
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

// ── Explain a denied permission
const denialExplain = await inspect.explain(ctx, {
    principal: charlie,
    permission: "billing.read",
});
console.log(`\n  explain(charlie, "billing.read"):`);
console.log(`    allowed:     ${denialExplain.allowed}`);
console.log(
    `    deniedBy:    ${denialExplain.deniedBy.length} path(s), allowedBy: ${denialExplain.allowedBy.length} path(s)`,
);

// ── Explain an unpermitted principal
const noAccess = await inspect.explain(ctx, { principal: dave, permission: "project.delete" });
console.log(`\n  explain(dave, "project.delete"):`);
console.log(`    allowed: ${noAccess.allowed}, paths: ${noAccess.allowedBy.length}`);

// ── List group memberships (direct)
const aliceDirect = await inspect.listGroupMemberships(ctx, alice);
console.log(
    `\n  listGroupMemberships(alice, direct): [${aliceDirect.map((g) => g.groupName).join(", ")}]`,
);

// ── List group memberships (transitive) — using nested-group scenario
const outerGroup = await rbac.createUserGroup(ctx, { groupName: "OuterTeam", tenantId: acme.id });
const innerGroup = await rbac.createUserGroup(ctx, { groupName: "InnerTeam", tenantId: acme.id });
await rbac.addMember(ctx, outerGroup.iri, innerGroup.iri); // InnerTeam ⊂ OuterTeam
await rbac.addMember(ctx, innerGroup.iri, bob);

const bobTransitive = await inspect.listGroupMemberships(ctx, bob, { transitive: true });
console.log(
    `  listGroupMemberships(bob, transitive): [${bobTransitive.map((g) => g.groupName).join(", ")}]`,
);

// ── List members of a group (transitive)
const outerMembers = await inspect.listGroupMembers(ctx, outerGroup.iri, { transitive: true });
console.log(
    `  listGroupMembers(OuterTeam, transitive): bob in list? ${outerMembers.includes(bob)}`,
);

// ── List groups with their members summary
const withMembers = await inspect.listGroupsWithMembers(ctx, acme.id);
console.log(`\n  listGroupsWithMembers(acme):`);
for (const g of withMembers.filter((g) => g.members.length > 0)) {
    console.log(`    ${g.groupName}: ${g.members.length} member(s)`);
}

// ── Done ──────────────────────────────────────────────────────────────────────

section("Done");
console.log("  All examples completed.\n");
await knex.destroy();
