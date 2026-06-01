/**
 * Extension lifecycle for @jasonscharf/convos.
 *
 * installConvos()   — seeds all convos permissions and the two built-in roles
 *                     into the RBAC store. Safe to call at application startup
 *                     or from a DB migration step.
 * uninstallConvos() — placeholder; full role/permission cleanup requires a
 *                     deleteRole() method on RbacService which doesn't exist
 *                     yet.  For now, callers should revoke individual grants
 *                     they issued and drop the extension data via migrations.
 */

import type { RbacService } from "@jasonscharf/rbac";
import type { ServerContext } from "@jasonscharf/server";
import {
    ALL_CONVOS_PERMISSIONS,
    CONVO_MODERATOR_PERMISSIONS,
    CONVO_USER_PERMISSIONS,
} from "./permissions.js";

export const CONVO_USER_ROLE_NAME = "ConvoUser";
export const CONVO_MODERATOR_ROLE_NAME = "ConvoModerator";

export interface ConvosInstallResult {
    userRoleIri: string;
    moderatorRoleIri: string;
    /** Permission key → IRI for every seeded convos permission. */
    permissionIris: Record<string, string>;
}

/**
 * Seed all convos permissions and the two built-in roles.
 *
 * Permissions are found-or-created by key so repeated calls are idempotent.
 * Roles are always created fresh — call once at startup (or from a migration)
 * and persist the returned IRIs if you need them later.
 */
export async function installConvos(
    ctx: ServerContext,
    rbac: RbacService,
    tenantId: string | null = null,
): Promise<ConvosInstallResult> {
    // ── Permissions ───────────────────────────────────────────────────────────
    const permissionIris: Record<string, string> = {};

    for (const key of ALL_CONVOS_PERMISSIONS) {
        const existing = await rbac.findPermissionByKey(ctx, key);
        const perm = existing ?? (await rbac.createPermission(ctx, key));
        permissionIris[key] = perm.iri;
    }

    // ── ConvoUser role ────────────────────────────────────────────────────────
    const userRole = await rbac.createRole(ctx, { roleName: CONVO_USER_ROLE_NAME, tenantId });
    for (const key of CONVO_USER_PERMISSIONS) {
        const pIri = permissionIris[key];
        if (pIri) {
            await rbac.addPermissionToRole(ctx, userRole.iri, pIri);
        }
    }

    // ── ConvoModerator role ───────────────────────────────────────────────────
    const modRole = await rbac.createRole(ctx, {
        roleName: CONVO_MODERATOR_ROLE_NAME,
        tenantId,
    });
    for (const key of CONVO_MODERATOR_PERMISSIONS) {
        const pIri = permissionIris[key];
        if (pIri) {
            await rbac.addPermissionToRole(ctx, modRole.iri, pIri);
        }
    }

    return {
        userRoleIri: userRole.iri,
        moderatorRoleIri: modRole.iri,
        permissionIris,
    };
}

/**
 * Revoke all grants the caller issued against the roles returned by a prior
 * installConvos() call.  Pass the array of grant IRIs you created so they can
 * be explicitly revoked.
 *
 * Full role/permission node deletion requires a deleteRole() API on
 * RbacService which does not exist yet.  Use a DB migration to hard-delete
 * the role nodes from the RBAC graph when removing the extension entirely.
 */
export async function uninstallConvos(
    ctx: ServerContext,
    rbac: RbacService,
    grantIris: string[],
): Promise<void> {
    for (const grantIri of grantIris) {
        await rbac.revoke(ctx, grantIri);
    }
}
