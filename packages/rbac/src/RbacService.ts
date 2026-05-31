import { actsForIRI, IRI } from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { ServerContext } from "@jasonscharf/server";
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
    CheckOptions,
    PermissionEntity,
    PolicyGrantEntity,
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

    /** Returns true if the principal has the permission in the given scope. */
    async can(ctx: ServerContext, opts: CheckOptions): Promise<boolean> {
        return this._checker.check(ctx, opts);
    }

    /** Throws if the principal lacks the permission. */
    async assert(ctx: ServerContext, opts: CheckOptions): Promise<void> {
        const allowed = await this._checker.check(ctx, opts);
        if (!allowed) {
            throw new Error(
                `Access denied: "${opts.principal}" lacks "${opts.permission}"${opts.scope ? ` on "${opts.scope}"` : ""}.`,
            );
        }
    }

    /** Returns the full set of permission keys available to the principal in scope. */
    async resolvePermissions(
        ctx: ServerContext,
        principalIri: string,
        scopeIri?: string,
    ): Promise<Set<string>> {
        return this._checker.resolvePermissions(ctx, principalIri, scopeIri);
    }

    // ── Tenants ───────────────────────────────────────────────────────────────

    async createTenant(ctx: ServerContext, name: string): Promise<TenantEntity> {
        return this._tenants.create(ctx, { tenantName: name });
    }

    async getTenant(ctx: ServerContext, id: string): Promise<TenantEntity | null> {
        return this._tenants.findById(ctx, id);
    }

    async listTenants(ctx: ServerContext): Promise<TenantEntity[]> {
        return this._tenants.listAll(ctx);
    }

    // ── Permissions ───────────────────────────────────────────────────────────

    async createPermission(ctx: ServerContext, key: string): Promise<PermissionEntity> {
        return this._permissions.create(ctx, { permissionKey: key });
    }

    async findPermissionByKey(ctx: ServerContext, key: string): Promise<PermissionEntity | null> {
        return this._permissions.findByKey(ctx, key);
    }

    // ── UserGroups ────────────────────────────────────────────────────────────

    async createUserGroup(
        ctx: ServerContext,
        input: Pick<UserGroupEntity, "groupName" | "tenantId">,
    ): Promise<UserGroupEntity> {
        return this._groups.create(ctx, input);
    }

    async getUserGroup(ctx: ServerContext, id: string): Promise<UserGroupEntity | null> {
        return this._groups.findById(ctx, id);
    }

    async findUserGroupByName(
        ctx: ServerContext,
        name: string,
        tenantId?: string,
    ): Promise<UserGroupEntity | null> {
        return this._groups.findByName(ctx, name, tenantId);
    }

    async listUserGroups(ctx: ServerContext, tenantId?: string): Promise<UserGroupEntity[]> {
        return this._groups.listAll(ctx, tenantId);
    }

    async updateUserGroup(
        ctx: ServerContext,
        id: string,
        patch: { groupName?: string },
    ): Promise<UserGroupEntity | null> {
        return this._groups.update(ctx, id, patch);
    }

    async deleteUserGroup(ctx: ServerContext, id: string): Promise<void> {
        return this._groups.delete(ctx, id);
    }

    async addMember(ctx: ServerContext, groupIri: string, memberIri: string): Promise<void> {
        return this._groups.addMember(ctx, groupIri, memberIri);
    }

    async removeMember(ctx: ServerContext, groupIri: string, memberIri: string): Promise<void> {
        return this._groups.removeMember(ctx, groupIri, memberIri);
    }

    async listMembers(ctx: ServerContext, groupIri: string): Promise<string[]> {
        return this._groups.listMembers(ctx, groupIri);
    }

    // ── Roles ─────────────────────────────────────────────────────────────────

    async createRole(
        ctx: ServerContext,
        input: Pick<RoleEntity, "roleName" | "tenantId">,
    ): Promise<RoleEntity> {
        return this._roles.create(ctx, input);
    }

    async addPermissionToRole(
        ctx: ServerContext,
        roleIri: string,
        permissionIri: string,
    ): Promise<void> {
        return this._roles.addPermission(ctx, roleIri, permissionIri);
    }

    async removePermissionFromRole(
        ctx: ServerContext,
        roleIri: string,
        permissionIri: string,
    ): Promise<void> {
        return this._roles.removePermission(ctx, roleIri, permissionIri);
    }

    async addRoleInheritance(
        ctx: ServerContext,
        childRoleIri: string,
        parentRoleIri: string,
    ): Promise<void> {
        return this._roles.addInheritance(ctx, childRoleIri, parentRoleIri);
    }

    // ── PolicyGrants ──────────────────────────────────────────────────────────

    async grant(ctx: ServerContext, input: CreateGrantInput): Promise<PolicyGrantEntity> {
        return this._grants.create(ctx, input);
    }

    async revoke(ctx: ServerContext, grantIri: string): Promise<void> {
        return this._grants.revoke(ctx, grantIri);
    }

    // ── Resources ─────────────────────────────────────────────────────────────

    async createResource(
        ctx: ServerContext,
        input: CreateResourceInput,
    ): Promise<ResourceNodeEntity> {
        return this._resources.create(ctx, input);
    }

    async setResourceParent(
        ctx: ServerContext,
        resourceIri: string,
        parentIri: string,
    ): Promise<void> {
        return this._resources.setParent(ctx, resourceIri, parentIri);
    }

    // ── Impersonation / delegation ────────────────────────────────────────────

    /** Allow `fromIri` to act as `toIri`. */
    async allowImpersonation(ctx: ServerContext, fromIri: string, toIri: string): Promise<void> {
        await this._store.insert(ctx, {
            subject: new IRI(fromIri),
            predicate: actsForIRI,
            object: new IRI(toIri),
            graph: RBAC_GRAPH,
        });
    }

    /** Revoke impersonation rights. */
    async revokeImpersonation(ctx: ServerContext, fromIri: string, toIri: string): Promise<void> {
        await this._store.delete(ctx, {
            subject: new IRI(fromIri),
            predicate: actsForIRI,
            object: new IRI(toIri),
            graph: RBAC_GRAPH,
        });
    }

    // ── Service accounts ──────────────────────────────────────────────────────

    async createServiceAccount(
        ctx: ServerContext,
        input: Pick<
            ServiceAccountEntity,
            "serviceAccountName" | "serviceAccountToken" | "tenantId"
        >,
    ): Promise<ServiceAccountEntity> {
        return this._serviceAccounts.create(ctx, input);
    }

    async deactivateServiceAccount(ctx: ServerContext, id: string): Promise<void> {
        return this._serviceAccounts.deactivate(ctx, id);
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
