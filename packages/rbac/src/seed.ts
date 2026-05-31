/**
 * Seeds the system-level RBAC entities into a TripleStore.
 *
 * Creates:
 *   - System root Tenant
 *   - Superusers Group (add principals here for unrestricted access)
 *   - Superadmin Role with the wildcard "*" permission
 *   - A PolicyGrant binding superusers → superadmin
 *
 * Safe to call multiple times — all inserts are idempotent.
 * Designed to be called after the DB schema is set up (migrations 001–003) but
 * before any application code runs.  The database migration 004_rbac.ts calls
 * the equivalent raw-SQL version; this function provides the same bootstrap
 * through the TripleStore API so tests and sandboxes can seed without needing
 * a direct Knex reference.
 */

import {
    grantPrincipalIRI,
    grantRoleIRI,
    groupNameIRI,
    IRI,
    isDenialIRI,
    isSystemRoleIRI,
    isSystemTenantIRI,
    isSystemUserGroupIRI,
    literal,
    PermissionIRI,
    PolicyGrantIRI,
    permissionKeyIRI,
    RoleIRI,
    rbacCreatedAtIRI,
    rbacGrantsIRI,
    rbacUpdatedAtIRI,
    roleNameIRI,
    TenantIRI,
    tenantNameIRI,
    UserGroupIRI,
} from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { ServerContext } from "@jasonscharf/server";
import {
    RBAC_GRAPH,
    RDF_TYPE,
    SYS_GRANT_IRI,
    SYS_SUPERADMIN_IRI,
    SYS_SUPERUSERS_IRI,
    SYS_TENANT_IRI,
    SYS_WILDCARD_PERM_IRI,
    XSD_BOOLEAN,
    XSD_DATETIME,
    XSD_STRING,
} from "./constants.js";

export async function seedSystemData(ctx: ServerContext, store: TripleStore): Promise<void> {
    const now = new Date().toISOString();

    const t = new IRI(SYS_TENANT_IRI);
    const g = new IRI(SYS_SUPERUSERS_IRI);
    const r = new IRI(SYS_SUPERADMIN_IRI);
    const p = new IRI(SYS_WILDCARD_PERM_IRI);
    const gr = new IRI(SYS_GRANT_IRI);

    const nowLit = literal(now, XSD_DATETIME);

    await store.insertMany(ctx, [
        // System Tenant
        { subject: t, predicate: RDF_TYPE, object: TenantIRI, graph: RBAC_GRAPH },
        {
            subject: t,
            predicate: tenantNameIRI,
            object: literal("System", XSD_STRING),
            graph: RBAC_GRAPH,
        },
        {
            subject: t,
            predicate: isSystemTenantIRI,
            object: literal("true", XSD_BOOLEAN),
            graph: RBAC_GRAPH,
        },
        { subject: t, predicate: rbacCreatedAtIRI, object: nowLit, graph: RBAC_GRAPH },
        { subject: t, predicate: rbacUpdatedAtIRI, object: nowLit, graph: RBAC_GRAPH },

        // Superusers Group
        { subject: g, predicate: RDF_TYPE, object: UserGroupIRI, graph: RBAC_GRAPH },
        {
            subject: g,
            predicate: groupNameIRI,
            object: literal("Superusers", XSD_STRING),
            graph: RBAC_GRAPH,
        },
        {
            subject: g,
            predicate: isSystemUserGroupIRI,
            object: literal("true", XSD_BOOLEAN),
            graph: RBAC_GRAPH,
        },
        { subject: g, predicate: rbacCreatedAtIRI, object: nowLit, graph: RBAC_GRAPH },
        { subject: g, predicate: rbacUpdatedAtIRI, object: nowLit, graph: RBAC_GRAPH },

        // Superadmin Role
        { subject: r, predicate: RDF_TYPE, object: RoleIRI, graph: RBAC_GRAPH },
        {
            subject: r,
            predicate: roleNameIRI,
            object: literal("Superadmin", XSD_STRING),
            graph: RBAC_GRAPH,
        },
        {
            subject: r,
            predicate: isSystemRoleIRI,
            object: literal("true", XSD_BOOLEAN),
            graph: RBAC_GRAPH,
        },
        { subject: r, predicate: rbacCreatedAtIRI, object: nowLit, graph: RBAC_GRAPH },
        { subject: r, predicate: rbacUpdatedAtIRI, object: nowLit, graph: RBAC_GRAPH },

        // Wildcard Permission
        { subject: p, predicate: RDF_TYPE, object: PermissionIRI, graph: RBAC_GRAPH },
        {
            subject: p,
            predicate: permissionKeyIRI,
            object: literal("*", XSD_STRING),
            graph: RBAC_GRAPH,
        },
        { subject: p, predicate: rbacCreatedAtIRI, object: nowLit, graph: RBAC_GRAPH },

        // Superadmin grants wildcard
        { subject: r, predicate: rbacGrantsIRI, object: p, graph: RBAC_GRAPH },

        // PolicyGrant: superusers → superadmin (no scope = system-wide)
        { subject: gr, predicate: RDF_TYPE, object: PolicyGrantIRI, graph: RBAC_GRAPH },
        { subject: gr, predicate: grantPrincipalIRI, object: g, graph: RBAC_GRAPH },
        { subject: gr, predicate: grantRoleIRI, object: r, graph: RBAC_GRAPH },
        {
            subject: gr,
            predicate: isDenialIRI,
            object: literal("false", XSD_BOOLEAN),
            graph: RBAC_GRAPH,
        },
        { subject: gr, predicate: rbacCreatedAtIRI, object: nowLit, graph: RBAC_GRAPH },
        { subject: gr, predicate: rbacUpdatedAtIRI, object: nowLit, graph: RBAC_GRAPH },
    ]);
}
