import { actsForIRI, IRI } from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { SecurityContext } from "../SecurityContext.js";
import type { ServerContext } from "../ServerContext.js";
import type { TenantEntity, TenantRepository } from "../tenancy/index.js";
import { tenantGraph, tenantGraphForInsert } from "../tenancy.js";
import { AccessChecker } from "./AccessChecker.js";
import { RBAC_ADMIN_PERMISSION } from "./constants.js";
import { RbacInspector } from "./RbacInspector.js";
import type { PermissionRepository } from "./repository/PermissionRepository.js";
import type {
    CreateGrantInput,
    PolicyGrantRepository,
} from "./repository/PolicyGrantRepository.js";
import type {
    CreateResourceInput,
    ResourceNodeRepository,
} from "./repository/ResourceNodeRepository.js";
import type { RoleRepository } from "./repository/RoleRepository.js";
import type { ServiceAccountRepository } from "./repository/ServiceAccountRepository.js";
import type { UserGroupRepository } from "./repository/UserGroupRepository.js";
import type {
    PermissionEntity,
    PolicyGrantEntity,
    RbacCheckArgs,
    ResourceNodeEntity,
    RoleEntity,
    ServiceAccountEntity,
    UserGroupEntity,
} from "./types.js";

export interface RbacServiceOptions {
    store: TripleStore;
    tenants: TenantRepository;
    groups: UserGroupRepository;
    roles: RoleRepository;
    grants: PolicyGrantRepository;
    permissions: PermissionRepository;
    resources: ResourceNodeRepository;
    serviceAccounts: ServiceAccountRepository;
}

export interface IdArgs {
    id: string;
}

export interface ScopeArgs {
    scope?: string;
}

export interface CreateTenantArgs {
    name: string;
}

export interface PermissionKeyArgs {
    key: string;
}

export interface FindUserGroupByNameArgs {
    name: string;
    tenantId?: string;
}

export interface TenantFilterArgs {
    tenantId?: string;
}

export interface UpdateUserGroupArgs {
    id: string;
    patch: { groupName?: string };
}

export interface GroupMemberArgs {
    groupIri: string;
    memberIri: string;
}

export interface GroupIriArgs {
    groupIri: string;
}

export interface RolePermissionArgs {
    roleIri: string;
    permissionIri: string;
}

export interface RoleInheritanceArgs {
    childRoleIri: string;
    parentRoleIri: string;
}

export interface GrantIriArgs {
    grantIri: string;
}

export interface SetResourceParentArgs {
    resourceIri: string;
    parentIri: string;
}

export interface ImpersonationArgs {
    fromIri: string;
    toIri: string;
}

/**
 * High-level RBAC orchestrator.
 *
 * Composes the lower-level repositories and AccessChecker into a single
 * façade that application code (middleware, resolvers, FBP components) can
 * depend on without knowing which repository handles each operation.
 *
 * This service is the authorization boundary for the rbac bounded context
 * (TRN-206). The repositories it composes are the trusted persistence layer and
 * perform NO checks; every administrative method here first asserts the caller
 * holds {@link RBAC_ADMIN_PERMISSION} via {@link _assertAdmin}. The internal
 * `systemSec` principal bypasses the AccessChecker (see AccessChecker.check), so
 * seeding, migrations, installers and background jobs continue to operate.
 *
 * The authorization primitives themselves — {@link can}, {@link assert} and
 * {@link resolvePermissions} — are intentionally NOT admin-gated: they are the
 * checker's own entrypoints, available to any caller to evaluate its own
 * effective permissions. Gating them would be circular (a check that needs a
 * check).
 */
export class RbacService {
    private readonly _store: TripleStore;
    private readonly _tenants: TenantRepository;
    private readonly _groups: UserGroupRepository;
    private readonly _roles: RoleRepository;
    private readonly _grants: PolicyGrantRepository;
    private readonly _permissions: PermissionRepository;
    private readonly _resources: ResourceNodeRepository;
    private readonly _serviceAccounts: ServiceAccountRepository;
    private readonly _checker: AccessChecker;

    constructor(opts: RbacServiceOptions) {
        this._store = opts.store;
        this._tenants = opts.tenants;
        this._groups = opts.groups;
        this._roles = opts.roles;
        this._grants = opts.grants;
        this._permissions = opts.permissions;
        this._resources = opts.resources;
        this._serviceAccounts = opts.serviceAccounts;
        this._checker = new AccessChecker(opts.store, opts.grants);
    }

    // ── Authorization ─────────────────────────────────────────────────────────

    /** Returns true if the principal in sec has the permission in the given scope. */
    async can(ctx: ServerContext, sec: SecurityContext, args: RbacCheckArgs): Promise<boolean> {
        if (!sec.principalIri) {
            return false;
        }
        return this._checker.check(ctx, {
            principal: sec.principalIri,
            permission: args.permission,
            scope: args.scope,
            scopeChain: args.scopeChain,
            actingAs: sec.isImpersonating ? sec.actingAsIri : undefined,
        });
    }

    /** Throws if the principal in sec lacks the permission. */
    async assert(ctx: ServerContext, sec: SecurityContext, args: RbacCheckArgs): Promise<void> {
        const allowed = await this.can(ctx, sec, args);
        if (!allowed) {
            const who = sec.principalIri ?? "anonymous";
            const where = args.scope ? ` on "${args.scope}"` : "";
            throw new Error(`Access denied: "${who}" lacks "${args.permission}"${where}.`);
        }
    }

    /** Returns the full set of permission keys available to the principal in scope. */
    async resolvePermissions(
        ctx: ServerContext,
        sec: SecurityContext,
        args: ScopeArgs,
    ): Promise<Set<string>> {
        if (!sec.principalIri) {
            return new Set();
        }
        return this._checker.resolvePermissions(ctx, sec.principalIri, args.scope);
    }

    /**
     * Asserts the caller holds the RBAC admin capability. Shared guard for every
     * administrative method below. `systemSec` bypasses the AccessChecker, so
     * seeding/installers/migrations are unaffected (see class doc).
     */
    private async _assertAdmin(ctx: ServerContext, sec: SecurityContext): Promise<void> {
        await this.assert(ctx, sec, { permission: RBAC_ADMIN_PERMISSION });
    }

    // ── Tenants ───────────────────────────────────────────────────────────────

    /** Enforced: requires RBAC_ADMIN_PERMISSION (TRN-206). */
    async createTenant(
        ctx: ServerContext,
        sec: SecurityContext,
        args: CreateTenantArgs,
    ): Promise<TenantEntity> {
        await this._assertAdmin(ctx, sec);
        return this._tenants.create(ctx, sec, { name: args.name });
    }

    /** Enforced: requires RBAC_ADMIN_PERMISSION (RBAC config read, TRN-206). */
    async getTenant(
        ctx: ServerContext,
        sec: SecurityContext,
        args: IdArgs,
    ): Promise<TenantEntity | null> {
        await this._assertAdmin(ctx, sec);
        return this._tenants.findById(ctx, sec, args);
    }

    /** Enforced: requires RBAC_ADMIN_PERMISSION (RBAC config read, TRN-206). */
    async listTenants(ctx: ServerContext, sec: SecurityContext): Promise<TenantEntity[]> {
        await this._assertAdmin(ctx, sec);
        return this._tenants.listAll(ctx, sec);
    }

    // ── Permissions ───────────────────────────────────────────────────────────

    /** Enforced: requires RBAC_ADMIN_PERMISSION (TRN-206). */
    async createPermission(
        ctx: ServerContext,
        sec: SecurityContext,
        args: PermissionKeyArgs,
    ): Promise<PermissionEntity> {
        await this._assertAdmin(ctx, sec);
        return this._permissions.create(ctx, sec, { permissionKey: args.key });
    }

    /** Enforced: requires RBAC_ADMIN_PERMISSION (RBAC config read, TRN-206). */
    async findPermissionByKey(
        ctx: ServerContext,
        sec: SecurityContext,
        args: PermissionKeyArgs,
    ): Promise<PermissionEntity | null> {
        await this._assertAdmin(ctx, sec);
        return this._permissions.findByKey(ctx, sec, args);
    }

    // ── UserGroups ────────────────────────────────────────────────────────────

    /** Enforced: requires RBAC_ADMIN_PERMISSION (TRN-206). */
    async createUserGroup(
        ctx: ServerContext,
        sec: SecurityContext,
        args: { groupName: string; tenantId?: string | null },
    ): Promise<UserGroupEntity> {
        await this._assertAdmin(ctx, sec);
        return this._groups.create(ctx, sec, args);
    }

    /** Enforced: requires RBAC_ADMIN_PERMISSION (RBAC config read, TRN-206). */
    async getUserGroup(
        ctx: ServerContext,
        sec: SecurityContext,
        args: IdArgs,
    ): Promise<UserGroupEntity | null> {
        await this._assertAdmin(ctx, sec);
        return this._groups.findById(ctx, sec, args);
    }

    /** Enforced: requires RBAC_ADMIN_PERMISSION (RBAC config read, TRN-206). */
    async findUserGroupByName(
        ctx: ServerContext,
        sec: SecurityContext,
        args: FindUserGroupByNameArgs,
    ): Promise<UserGroupEntity | null> {
        await this._assertAdmin(ctx, sec);
        return this._groups.findByName(ctx, sec, args);
    }

    /** Enforced: requires RBAC_ADMIN_PERMISSION (RBAC config read, TRN-206). */
    async listUserGroups(
        ctx: ServerContext,
        sec: SecurityContext,
        args: TenantFilterArgs = {},
    ): Promise<UserGroupEntity[]> {
        await this._assertAdmin(ctx, sec);
        return this._groups.listAll(ctx, sec, args);
    }

    /** Enforced: requires RBAC_ADMIN_PERMISSION (TRN-206). */
    async updateUserGroup(
        ctx: ServerContext,
        sec: SecurityContext,
        args: UpdateUserGroupArgs,
    ): Promise<UserGroupEntity | null> {
        await this._assertAdmin(ctx, sec);
        return this._groups.update(ctx, sec, args);
    }

    /** Enforced: requires RBAC_ADMIN_PERMISSION (TRN-206). */
    async deleteUserGroup(ctx: ServerContext, sec: SecurityContext, args: IdArgs): Promise<void> {
        await this._assertAdmin(ctx, sec);
        return this._groups.delete(ctx, sec, args);
    }

    /** Enforced: requires RBAC_ADMIN_PERMISSION (TRN-206). */
    async addMember(
        ctx: ServerContext,
        sec: SecurityContext,
        args: GroupMemberArgs,
    ): Promise<void> {
        await this._assertAdmin(ctx, sec);
        return this._groups.addMember(ctx, sec, args);
    }

    /** Enforced: requires RBAC_ADMIN_PERMISSION (TRN-206). */
    async removeMember(
        ctx: ServerContext,
        sec: SecurityContext,
        args: GroupMemberArgs,
    ): Promise<void> {
        await this._assertAdmin(ctx, sec);
        return this._groups.removeMember(ctx, sec, args);
    }

    /** Enforced: requires RBAC_ADMIN_PERMISSION (RBAC config read, TRN-206). */
    async listMembers(
        ctx: ServerContext,
        sec: SecurityContext,
        args: GroupIriArgs,
    ): Promise<string[]> {
        await this._assertAdmin(ctx, sec);
        return this._groups.listMembers(ctx, sec, args);
    }

    // ── Roles ─────────────────────────────────────────────────────────────────

    /** Enforced: requires RBAC_ADMIN_PERMISSION (TRN-206). */
    async createRole(
        ctx: ServerContext,
        sec: SecurityContext,
        args: { roleName: string; tenantId?: string | null },
    ): Promise<RoleEntity> {
        await this._assertAdmin(ctx, sec);
        return this._roles.create(ctx, sec, args);
    }

    /** Enforced: requires RBAC_ADMIN_PERMISSION (TRN-206). */
    async addPermissionToRole(
        ctx: ServerContext,
        sec: SecurityContext,
        args: RolePermissionArgs,
    ): Promise<void> {
        await this._assertAdmin(ctx, sec);
        return this._roles.addPermission(ctx, sec, args);
    }

    /** Enforced: requires RBAC_ADMIN_PERMISSION (TRN-206). */
    async removePermissionFromRole(
        ctx: ServerContext,
        sec: SecurityContext,
        args: RolePermissionArgs,
    ): Promise<void> {
        await this._assertAdmin(ctx, sec);
        return this._roles.removePermission(ctx, sec, args);
    }

    /** Enforced: requires RBAC_ADMIN_PERMISSION (TRN-206). */
    async addRoleInheritance(
        ctx: ServerContext,
        sec: SecurityContext,
        args: RoleInheritanceArgs,
    ): Promise<void> {
        await this._assertAdmin(ctx, sec);
        return this._roles.addInheritance(ctx, sec, {
            roleIri: args.childRoleIri,
            parentRoleIri: args.parentRoleIri,
        });
    }

    // ── PolicyGrants ──────────────────────────────────────────────────────────

    /** Enforced: requires RBAC_ADMIN_PERMISSION (TRN-206). */
    async grant(
        ctx: ServerContext,
        sec: SecurityContext,
        args: CreateGrantInput,
    ): Promise<PolicyGrantEntity> {
        await this._assertAdmin(ctx, sec);
        return this._grants.create(ctx, sec, args);
    }

    /** Enforced: requires RBAC_ADMIN_PERMISSION (TRN-206). */
    async revoke(ctx: ServerContext, sec: SecurityContext, args: GrantIriArgs): Promise<void> {
        await this._assertAdmin(ctx, sec);
        return this._grants.revoke(ctx, sec, args);
    }

    // ── Resources ─────────────────────────────────────────────────────────────

    /** Enforced: requires RBAC_ADMIN_PERMISSION (TRN-206). */
    async createResource(
        ctx: ServerContext,
        sec: SecurityContext,
        args: CreateResourceInput,
    ): Promise<ResourceNodeEntity> {
        await this._assertAdmin(ctx, sec);
        return this._resources.create(ctx, sec, args);
    }

    /** Enforced: requires RBAC_ADMIN_PERMISSION (TRN-206). */
    async setResourceParent(
        ctx: ServerContext,
        sec: SecurityContext,
        args: SetResourceParentArgs,
    ): Promise<void> {
        await this._assertAdmin(ctx, sec);
        return this._resources.setParent(ctx, sec, args);
    }

    // ── Impersonation / delegation ────────────────────────────────────────────

    /** Enforced: requires RBAC_ADMIN_PERMISSION. Allow `fromIri` to act as `toIri` (TRN-206). */
    async allowImpersonation(
        ctx: ServerContext,
        sec: SecurityContext,
        args: ImpersonationArgs,
    ): Promise<void> {
        await this._assertAdmin(ctx, sec);
        await this._store.insert(ctx, {
            subject: new IRI(args.fromIri),
            predicate: actsForIRI,
            object: new IRI(args.toIri),
            graph: tenantGraphForInsert(ctx),
        });
    }

    /** Enforced: requires RBAC_ADMIN_PERMISSION. Revoke impersonation rights (TRN-206). */
    async revokeImpersonation(
        ctx: ServerContext,
        sec: SecurityContext,
        args: ImpersonationArgs,
    ): Promise<void> {
        await this._assertAdmin(ctx, sec);
        await this._store.delete(ctx, {
            subject: new IRI(args.fromIri),
            predicate: actsForIRI,
            object: new IRI(args.toIri),
            graph: tenantGraph(ctx),
        });
    }

    // ── Service accounts ──────────────────────────────────────────────────────

    /** Enforced: requires RBAC_ADMIN_PERMISSION (TRN-206). */
    async createServiceAccount(
        ctx: ServerContext,
        sec: SecurityContext,
        args: { serviceAccountName: string; serviceAccountToken: string; tenantId?: string | null },
    ): Promise<ServiceAccountEntity> {
        await this._assertAdmin(ctx, sec);
        return this._serviceAccounts.create(ctx, sec, args);
    }

    /** Enforced: requires RBAC_ADMIN_PERMISSION (TRN-206). */
    async deactivateServiceAccount(
        ctx: ServerContext,
        sec: SecurityContext,
        args: IdArgs,
    ): Promise<void> {
        await this._assertAdmin(ctx, sec);
        return this._serviceAccounts.deactivate(ctx, sec, args);
    }

    // ── Inspector ─────────────────────────────────────────────────────────────

    /**
     * Returns a pre-wired RbacInspector for this service instance.
     * Use it to explain permissions, trace group memberships, and list
     * effective permission sets — all without mutating anything.
     */
    inspector(): RbacInspector {
        return new RbacInspector(this._store, this._grants, this._groups, this._checker);
    }
}
