import { actsForIRI, IRI } from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { SecurityContext, ServerContext } from "@jasonscharf/server";
import { AccessChecker } from "./AccessChecker.js";
import { RBAC_GRAPH } from "./constants.js";
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
import type { TenantRepository } from "./repository/TenantRepository.js";
import type { UserGroupRepository } from "./repository/UserGroupRepository.js";
import type {
    PermissionEntity,
    PolicyGrantEntity,
    RbacCheckArgs,
    ResourceNodeEntity,
    RoleEntity,
    ServiceAccountEntity,
    TenantEntity,
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

    // ── Tenants ───────────────────────────────────────────────────────────────

    /** @insecure @nochecks */
    async createTenant(
        ctx: ServerContext,
        sec: SecurityContext,
        args: CreateTenantArgs,
    ): Promise<TenantEntity> {
        return this._tenants.create(ctx, sec, { tenantName: args.name });
    }

    /** @insecure @nochecks */
    async getTenant(
        ctx: ServerContext,
        sec: SecurityContext,
        args: IdArgs,
    ): Promise<TenantEntity | null> {
        return this._tenants.findById(ctx, sec, args);
    }

    /** @insecure @nochecks */
    async listTenants(ctx: ServerContext, sec: SecurityContext): Promise<TenantEntity[]> {
        return this._tenants.listAll(ctx, sec);
    }

    // ── Permissions ───────────────────────────────────────────────────────────

    /** @insecure @nochecks */
    async createPermission(
        ctx: ServerContext,
        sec: SecurityContext,
        args: PermissionKeyArgs,
    ): Promise<PermissionEntity> {
        return this._permissions.create(ctx, sec, { permissionKey: args.key });
    }

    /** @insecure @nochecks */
    async findPermissionByKey(
        ctx: ServerContext,
        sec: SecurityContext,
        args: PermissionKeyArgs,
    ): Promise<PermissionEntity | null> {
        return this._permissions.findByKey(ctx, sec, args);
    }

    // ── UserGroups ────────────────────────────────────────────────────────────

    /** @insecure @nochecks */
    async createUserGroup(
        ctx: ServerContext,
        sec: SecurityContext,
        args: { groupName: string; tenantId?: string | null },
    ): Promise<UserGroupEntity> {
        return this._groups.create(ctx, sec, args);
    }

    /** @insecure @nochecks */
    async getUserGroup(
        ctx: ServerContext,
        sec: SecurityContext,
        args: IdArgs,
    ): Promise<UserGroupEntity | null> {
        return this._groups.findById(ctx, sec, args);
    }

    /** @insecure @nochecks */
    async findUserGroupByName(
        ctx: ServerContext,
        sec: SecurityContext,
        args: FindUserGroupByNameArgs,
    ): Promise<UserGroupEntity | null> {
        return this._groups.findByName(ctx, sec, args);
    }

    /** @insecure @nochecks */
    async listUserGroups(
        ctx: ServerContext,
        sec: SecurityContext,
        args: TenantFilterArgs = {},
    ): Promise<UserGroupEntity[]> {
        return this._groups.listAll(ctx, sec, args);
    }

    /** @insecure @nochecks */
    async updateUserGroup(
        ctx: ServerContext,
        sec: SecurityContext,
        args: UpdateUserGroupArgs,
    ): Promise<UserGroupEntity | null> {
        return this._groups.update(ctx, sec, args);
    }

    /** @insecure @nochecks */
    async deleteUserGroup(ctx: ServerContext, sec: SecurityContext, args: IdArgs): Promise<void> {
        return this._groups.delete(ctx, sec, args);
    }

    /** @insecure @nochecks */
    async addMember(
        ctx: ServerContext,
        sec: SecurityContext,
        args: GroupMemberArgs,
    ): Promise<void> {
        return this._groups.addMember(ctx, sec, args);
    }

    /** @insecure @nochecks */
    async removeMember(
        ctx: ServerContext,
        sec: SecurityContext,
        args: GroupMemberArgs,
    ): Promise<void> {
        return this._groups.removeMember(ctx, sec, args);
    }

    /** @insecure @nochecks */
    async listMembers(
        ctx: ServerContext,
        sec: SecurityContext,
        args: GroupIriArgs,
    ): Promise<string[]> {
        return this._groups.listMembers(ctx, sec, args);
    }

    // ── Roles ─────────────────────────────────────────────────────────────────

    /** @insecure @nochecks */
    async createRole(
        ctx: ServerContext,
        sec: SecurityContext,
        args: { roleName: string; tenantId?: string | null },
    ): Promise<RoleEntity> {
        return this._roles.create(ctx, sec, args);
    }

    /** @insecure @nochecks */
    async addPermissionToRole(
        ctx: ServerContext,
        sec: SecurityContext,
        args: RolePermissionArgs,
    ): Promise<void> {
        return this._roles.addPermission(ctx, sec, args);
    }

    /** @insecure @nochecks */
    async removePermissionFromRole(
        ctx: ServerContext,
        sec: SecurityContext,
        args: RolePermissionArgs,
    ): Promise<void> {
        return this._roles.removePermission(ctx, sec, args);
    }

    /** @insecure @nochecks */
    async addRoleInheritance(
        ctx: ServerContext,
        sec: SecurityContext,
        args: RoleInheritanceArgs,
    ): Promise<void> {
        return this._roles.addInheritance(ctx, sec, {
            roleIri: args.childRoleIri,
            parentRoleIri: args.parentRoleIri,
        });
    }

    // ── PolicyGrants ──────────────────────────────────────────────────────────

    /** @insecure @nochecks */
    async grant(
        ctx: ServerContext,
        sec: SecurityContext,
        args: CreateGrantInput,
    ): Promise<PolicyGrantEntity> {
        return this._grants.create(ctx, sec, args);
    }

    /** @insecure @nochecks */
    async revoke(ctx: ServerContext, sec: SecurityContext, args: GrantIriArgs): Promise<void> {
        return this._grants.revoke(ctx, sec, args);
    }

    // ── Resources ─────────────────────────────────────────────────────────────

    /** @insecure @nochecks */
    async createResource(
        ctx: ServerContext,
        sec: SecurityContext,
        args: CreateResourceInput,
    ): Promise<ResourceNodeEntity> {
        return this._resources.create(ctx, sec, args);
    }

    /** @insecure @nochecks */
    async setResourceParent(
        ctx: ServerContext,
        sec: SecurityContext,
        args: SetResourceParentArgs,
    ): Promise<void> {
        return this._resources.setParent(ctx, sec, args);
    }

    // ── Impersonation / delegation ────────────────────────────────────────────

    /** @insecure @nochecks Allow `fromIri` to act as `toIri`. */
    async allowImpersonation(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: ImpersonationArgs,
    ): Promise<void> {
        await this._store.insert(ctx, {
            subject: new IRI(args.fromIri),
            predicate: actsForIRI,
            object: new IRI(args.toIri),
            graph: RBAC_GRAPH,
        });
    }

    /** @insecure @nochecks Revoke impersonation rights. */
    async revokeImpersonation(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: ImpersonationArgs,
    ): Promise<void> {
        await this._store.delete(ctx, {
            subject: new IRI(args.fromIri),
            predicate: actsForIRI,
            object: new IRI(args.toIri),
            graph: RBAC_GRAPH,
        });
    }

    // ── Service accounts ──────────────────────────────────────────────────────

    /** @insecure @nochecks */
    async createServiceAccount(
        ctx: ServerContext,
        sec: SecurityContext,
        args: { serviceAccountName: string; serviceAccountToken: string; tenantId?: string | null },
    ): Promise<ServiceAccountEntity> {
        return this._serviceAccounts.create(ctx, sec, args);
    }

    /** @insecure @nochecks */
    async deactivateServiceAccount(
        ctx: ServerContext,
        sec: SecurityContext,
        args: IdArgs,
    ): Promise<void> {
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
