/**
 * Tern infrastructure extension for RBAC.
 *
 * Registers as "tern.rbac" and:
 *   1. Seeds the system-level RBAC graph (superusers group, superadmin role,
 *      wildcard permission) — idempotent.
 *   2. Constructs and returns a fully-wired RbacService.
 *
 * Usage in a consuming app:
 *
 *   import { rbacExtension, getRbacService } from "@jasonscharf/server";
 *
 *   const installed = await ternApp.use(rbacExtension);
 *   const rbac = getRbacService(installed);
 *
 * The RbacService is also merged into the HandlerContext automatically, so
 * WS message handlers can access it as ctx.rbac.
 */

import type { ExtensionInstallContext, InstalledExtension, TernExtension } from "@jasonscharf/app";
import type { TripleStore } from "@jasonscharf/data";
import { buildServerContext } from "../ServerContext.js";
import { RbacService } from "./RbacService.js";
import { PermissionRepository } from "./repository/PermissionRepository.js";
import { PolicyGrantRepository } from "./repository/PolicyGrantRepository.js";
import { ResourceNodeRepository } from "./repository/ResourceNodeRepository.js";
import { RoleRepository } from "./repository/RoleRepository.js";
import { ServiceAccountRepository } from "./repository/ServiceAccountRepository.js";
import { TenantRepository } from "./repository/TenantRepository.js";
import { UserGroupRepository } from "./repository/UserGroupRepository.js";
import { seedSystemData } from "./seed.js";

export const RBAC_EXTENSION_NAME = "tern.rbac" as const;

export const rbacExtension: TernExtension = {
    name: RBAC_EXTENSION_NAME,
    version: "0.1.0",
    description: "Role-based access control — tenants, groups, roles, permissions, grants.",

    async install({ store }: ExtensionInstallContext) {
        const typedStore = store as TripleStore;
        await seedSystemData(buildServerContext(typedStore), typedStore);

        const rbac = new RbacService({
            store: typedStore,
            tenants: new TenantRepository(typedStore),
            groups: new UserGroupRepository(typedStore),
            roles: new RoleRepository(typedStore),
            grants: new PolicyGrantRepository(typedStore),
            permissions: new PermissionRepository(typedStore),
            resources: new ResourceNodeRepository(typedStore),
            serviceAccounts: new ServiceAccountRepository(typedStore),
        });

        return { rbac };
    },
};

/**
 * Type-safe accessor — extracts the RbacService from an InstalledExtension
 * returned by `ternApp.use(rbacExtension)`.
 */
export function getRbacService(installed: InstalledExtension): RbacService {
    const svc = installed.services.rbac;
    if (!(svc instanceof RbacService)) {
        throw new Error(
            `getRbacService: expected RbacService in installed.services.rbac — ` +
                `did you call ternApp.use(rbacExtension)?`,
        );
    }
    return svc;
}
