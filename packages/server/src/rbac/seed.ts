/**
 * Seeds the system-level RBAC entities into a TripleStore.
 *
 * Creates:
 *   - System Install (the platform deployment)
 *   - System Tenant (scoped under the Install)
 *   - Superusers Group (add principals here for unrestricted access)
 *   - Superadmin Role with the wildcard "*" permission
 *   - A PolicyGrant binding superusers → superadmin
 *
 * Safe to call multiple times — all inserts are idempotent.
 * Designed to be called after the DB schema is set up (migration 001_init) but
 * before any application code runs.  The database migration 001_init.ts calls
 * the equivalent raw-SQL version; this function provides the same bootstrap
 * through the TripleStore API so tests and sandboxes can seed without needing
 * a direct Knex reference.
 */

import {
    groupNameIRI,
    hasPrincipalIRI,
    hasRoleIRI,
    hasTenantIRI,
    IRI,
    InstallIRI,
    installNameIRI,
    isDenialIRI,
    isSystemInstallIRI,
    isSystemRoleIRI,
    isSystemTenantIRI,
    isSystemGroupIRI,
    literal,
    PermissionIRI,
    PolicyGrantIRI,
    permissionKeyIRI,
    RoleIRI,
    grantsIRI,
    roleNameIRI,
    TenantIRI,
    tenantNameIRI,
    UserGroupIRI,
} from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { ServerContext } from "../ServerContext.js";
import {
    RDF_TYPE,
    SYS_GRANT_IRI,
    SYS_INSTALL_IRI,
    SYS_SUPERADMIN_IRI,
    SYS_SUPERUSERS_IRI,
    SYS_TENANT_IRI,
    SYS_WILDCARD_PERM_IRI,
    XSD_BOOLEAN,
    XSD_STRING,
} from "./constants.js";
import { tenantGraphForInsert } from "../tenancy.js";

export async function seedSystemData(ctx: ServerContext, store: TripleStore): Promise<void> {
    const i = new IRI(SYS_INSTALL_IRI);
    const t = new IRI(SYS_TENANT_IRI);
    const g = new IRI(SYS_SUPERUSERS_IRI);
    const r = new IRI(SYS_SUPERADMIN_IRI);
    const p = new IRI(SYS_WILDCARD_PERM_IRI);
    const gr = new IRI(SYS_GRANT_IRI);

    await store.insertMany(ctx, [
        // System Install
        { subject: i, predicate: RDF_TYPE, object: InstallIRI, graph: tenantGraphForInsert(ctx) },
        {
            subject: i,
            predicate: installNameIRI,
            object: literal("System", XSD_STRING),
            graph: tenantGraphForInsert(ctx),
        },
        {
            subject: i,
            predicate: isSystemInstallIRI,
            object: literal("true", XSD_BOOLEAN),
            graph: tenantGraphForInsert(ctx),
        },
        // Install → Tenant (outward containment edge)
        { subject: i, predicate: hasTenantIRI, object: t, graph: tenantGraphForInsert(ctx) },

        // System Tenant
        { subject: t, predicate: RDF_TYPE, object: TenantIRI, graph: tenantGraphForInsert(ctx) },
        {
            subject: t,
            predicate: tenantNameIRI,
            object: literal("System", XSD_STRING),
            graph: tenantGraphForInsert(ctx),
        },
        {
            subject: t,
            predicate: isSystemTenantIRI,
            object: literal("true", XSD_BOOLEAN),
            graph: tenantGraphForInsert(ctx),
        },

        // Superusers Group
        { subject: g, predicate: RDF_TYPE, object: UserGroupIRI, graph: tenantGraphForInsert(ctx) },
        {
            subject: g,
            predicate: groupNameIRI,
            object: literal("Superusers", XSD_STRING),
            graph: tenantGraphForInsert(ctx),
        },
        {
            subject: g,
            predicate: isSystemGroupIRI,
            object: literal("true", XSD_BOOLEAN),
            graph: tenantGraphForInsert(ctx),
        },

        // Superadmin Role
        { subject: r, predicate: RDF_TYPE, object: RoleIRI, graph: tenantGraphForInsert(ctx) },
        {
            subject: r,
            predicate: roleNameIRI,
            object: literal("Superadmin", XSD_STRING),
            graph: tenantGraphForInsert(ctx),
        },
        {
            subject: r,
            predicate: isSystemRoleIRI,
            object: literal("true", XSD_BOOLEAN),
            graph: tenantGraphForInsert(ctx),
        },

        // Wildcard Permission
        { subject: p, predicate: RDF_TYPE, object: PermissionIRI, graph: tenantGraphForInsert(ctx) },
        {
            subject: p,
            predicate: permissionKeyIRI,
            object: literal("*", XSD_STRING),
            graph: tenantGraphForInsert(ctx),
        },

        // Superadmin grants wildcard
        { subject: r, predicate: grantsIRI, object: p, graph: tenantGraphForInsert(ctx) },

        // PolicyGrant: superusers → superadmin (no scope = system-wide)
        { subject: gr, predicate: RDF_TYPE, object: PolicyGrantIRI, graph: tenantGraphForInsert(ctx) },
        { subject: gr, predicate: hasPrincipalIRI, object: g, graph: tenantGraphForInsert(ctx) },
        { subject: gr, predicate: hasRoleIRI, object: r, graph: tenantGraphForInsert(ctx) },
        {
            subject: gr,
            predicate: isDenialIRI,
            object: literal("false", XSD_BOOLEAN),
            graph: tenantGraphForInsert(ctx),
        },
    ]);
}
