import {
    groupNameIRI,
    IRI,
    inheritsFromIRI,
    isMemberOfIRI,
    permissionKeyIRI,
    rbacGrantsIRI,
    roleNameIRI,
} from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import { type SecurityContext, systemSec } from "../SecurityContext.js";
import type { ServerContext } from "../ServerContext.js";
import type { AccessChecker } from "./AccessChecker.js";
import { tenantGraph } from "../tenancy.js";
import type { PolicyGrantRepository } from "./repository/PolicyGrantRepository.js";
import type { UserGroupRepository } from "./repository/UserGroupRepository.js";
import { iriValue, literalValue } from "./repository/util.js";
import type { PolicyGrantEntity, UserGroupEntity } from "./types.js";

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * One path through the graph that contributes a permission to a principal.
 * Multiple paths can independently allow or deny the same permission.
 */
export interface GrantPath {
    /** IRI of the PolicyGrant node. */
    grantIri: string;
    /**
     * IRI of the principal (User, ServiceAccount, or UserGroup) the grant is
     * directly attached to.  May differ from the queried principal when the
     * permission is inherited through group membership.
     */
    grantedToPrincipalIri: string;
    /**
     * Chain of group IRIs between the queried principal and the grant target.
     * Empty when the grant is directly on the principal.
     */
    membershipChain: string[];
    /** IRI of the role granted (null for direct-permission grants). */
    roleIri: string | null;
    /** Human-readable role name (null for direct-permission grants). */
    roleName: string | null;
    /** Role inheritance path through which the target permission was reached. */
    roleInheritanceChain: string[];
    /** IRI of the Permission node (for direct-permission grants). */
    permissionIri: string | null;
    /** Scope the grant applies to (null = system-wide). */
    scopeIri: string | null;
    isDenial: boolean;
    expiresAt: Date | null;
}

/** Full explanation of why a principal does or does not have a permission. */
export interface PermissionExplanation {
    principal: string;
    permission: string;
    scope: string | undefined;
    /** Final decision. */
    allowed: boolean;
    /** Paths that allow the permission (after expiry filtering). */
    allowedBy: GrantPath[];
    /** Paths that deny the permission (after expiry filtering). */
    deniedBy: GrantPath[];
}

/** UserGroup with its direct members. */
export interface UserGroupWithMembers extends UserGroupEntity {
    members: string[];
}

export interface PrincipalScopeArgs {
    principalIri: string;
    scopeIri?: string;
}

export interface PrincipalTransitiveArgs {
    principalIri: string;
    transitive?: boolean;
}

export interface GroupTransitiveArgs {
    groupIri: string;
    transitive?: boolean;
}

export interface TenantFilterArgs {
    tenantId?: string;
}

// ── Inspector ─────────────────────────────────────────────────────────────────

/**
 * Read-only inspection utilities for debugging and introspecting RBAC state.
 *
 * All methods are safe to call from any context — they only read from the
 * store and never mutate it.
 */
export class RbacInspector {
    private readonly _store: TripleStore;
    private readonly _grants: PolicyGrantRepository;
    private readonly _groups: UserGroupRepository;
    private readonly _checker: AccessChecker;

    constructor(
        store: TripleStore,
        grants: PolicyGrantRepository,
        groups: UserGroupRepository,
        checker: AccessChecker,
    ) {
        this._store = store;
        this._grants = grants;
        this._groups = groups;
        this._checker = checker;
    }

    // ── Permission inspection ─────────────────────────────────────────────────

    /** @insecure @nochecks Alias for AccessChecker.resolvePermissions. */
    async listEffectivePermissions(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: PrincipalScopeArgs,
    ): Promise<Set<string>> {
        return this._checker.resolvePermissions(ctx, args.principalIri, args.scopeIri);
    }

    /** @insecure @nochecks Explains why a principal does or does not have a permission. */
    async explain(
        ctx: ServerContext,
        _sec: SecurityContext,
        opts: { principal: string; permission: string; scope?: string },
    ): Promise<PermissionExplanation> {
        const principals = await this._resolvePrincipalSet(ctx, opts.principal);
        const scopeChain = opts.scope ? await this._resolveScopeChain(ctx, opts.scope) : [];

        const rawGrants = await this._grants.findForPrincipals(ctx, systemSec, {
            principalIris: Array.from(principals),
            scopeIris: scopeChain,
        });
        const active = rawGrants.filter(
            (g) => g.grantExpiresAt == null || g.grantExpiresAt.getTime() > Date.now(),
        );

        const allowedBy: GrantPath[] = [];
        const deniedBy: GrantPath[] = [];

        for (const grant of active) {
            const membershipChain = await this._membershipChain(
                ctx,
                opts.principal,
                grant.hasPrincipal?.iri ?? "",
            );
            const path = await this._buildGrantPath(ctx, grant, membershipChain, opts.permission);
            if (path == null) {
                continue;
            }
            if (grant.isDenial) {
                deniedBy.push(path);
            } else {
                allowedBy.push(path);
            }
        }

        const deniedKeys = new Set(deniedBy.map((p) => p.permissionIri ?? opts.permission));
        const hasDenial =
            deniedKeys.has("*") ||
            deniedBy.some((p) =>
                p.roleIri != null
                    ? allowedBy.some((a) => a.roleIri === p.roleIri)
                    : p.permissionIri != null,
            );

        const allowed = !hasDenial && allowedBy.length > 0;

        return {
            principal: opts.principal,
            permission: opts.permission,
            scope: opts.scope,
            allowed,
            allowedBy,
            deniedBy,
        };
    }

    // ── Group / membership inspection ─────────────────────────────────────────

    /**
     * @insecure @nochecks Returns all UserGroups the principal directly belongs to.
     * Pass `transitive: true` to also include groups-of-groups.
     */
    async listGroupMemberships(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: PrincipalTransitiveArgs,
    ): Promise<UserGroupEntity[]> {
        if (args.transitive) {
            const allIris = await this._resolvePrincipalSet(ctx, args.principalIri);
            allIris.delete(args.principalIri);
            const results = await Promise.all(
                [...allIris].map((iri) => this._groups.findByIri(ctx, systemSec, { iriStr: iri })),
            );
            return results.filter((g): g is UserGroupEntity => g != null);
        }

        const directIris = await this._groups.listGroupsForPrincipal(ctx, systemSec, {
            principalIri: args.principalIri,
        });
        const results = await Promise.all(
            directIris.map((iri) => this._groups.findByIri(ctx, systemSec, { iriStr: iri })),
        );
        return results.filter((g): g is UserGroupEntity => g != null);
    }

    /**
     * @insecure @nochecks Returns all member IRIs of the given group.
     * Pass `transitive: true` to recursively expand nested groups.
     */
    async listGroupMembers(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: GroupTransitiveArgs,
    ): Promise<string[]> {
        if (!args.transitive) {
            return this._groups.listMembers(ctx, systemSec, { groupIri: args.groupIri });
        }

        const visited = new Set<string>();
        const queue = [args.groupIri];
        const members = new Set<string>();

        while (queue.length > 0) {
            const current = queue.shift();
            if (!current) {
                break;
            }
            const direct = await this._groups.listMembers(ctx, systemSec, { groupIri: current });
            for (const m of direct) {
                if (members.has(m)) {
                    continue;
                }
                members.add(m);
                const isGroup = await this._isGroup(ctx, m);
                if (isGroup && !visited.has(m)) {
                    visited.add(m);
                    queue.push(m);
                }
            }
        }
        return Array.from(members);
    }

    /**
     * @insecure @nochecks Returns each UserGroup in the tenant along with its direct member IRIs.
     */
    async listGroupsWithMembers(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: TenantFilterArgs = {},
    ): Promise<UserGroupWithMembers[]> {
        const groups = await this._groups.listAll(ctx, systemSec, { tenantId: args.tenantId });
        const memberLists = await Promise.all(
            groups.map((g) => this._groups.listMembers(ctx, systemSec, { groupIri: g.iri })),
        );
        return groups.map((g, i) => ({ ...g, members: memberLists[i] ?? [] }));
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private async _resolvePrincipalSet(
        ctx: ServerContext,
        principalIri: string,
    ): Promise<Set<string>> {
        const visited = new Set<string>([principalIri]);
        const queue = [principalIri];
        while (queue.length > 0) {
            const current = queue.shift();
            if (!current) {
                break;
            }
            const quads = await this._store.find(ctx, {
                subject: new IRI(current),
                predicate: isMemberOfIRI,
                graph: tenantGraph(ctx),
            });
            for (const q of quads) {
                const groupIri = iriValue(q.object);
                if (groupIri && !visited.has(groupIri)) {
                    visited.add(groupIri);
                    queue.push(groupIri);
                }
            }
        }
        return visited;
    }

    private async _resolveScopeChain(ctx: ServerContext, scopeIri: string): Promise<string[]> {
        const chain: string[] = [];
        const visited = new Set<string>();
        let current: string | null = scopeIri;
        while (current && !visited.has(current)) {
            visited.add(current);
            chain.push(current);
            const parentQuads = await this._store.find(ctx, {
                subject: new IRI(current),
                predicate: { value: "urn:sys:core:rbac:parentResource" } as IRI,
                graph: tenantGraph(ctx),
            });
            current = parentQuads.length > 0 ? (iriValue(parentQuads[0].object) ?? null) : null;
        }
        return chain;
    }

    private async _membershipChain(
        ctx: ServerContext,
        from: string,
        target: string,
    ): Promise<string[]> {
        if (from === target) {
            return [];
        }
        const parent = new Map<string, string>();
        const queue = [from];
        const visited = new Set<string>([from]);

        while (queue.length > 0) {
            const current = queue.shift();
            if (!current) {
                break;
            }
            const quads = await this._store.find(ctx, {
                subject: new IRI(current),
                predicate: isMemberOfIRI,
                graph: tenantGraph(ctx),
            });
            for (const q of quads) {
                const g = iriValue(q.object);
                if (!g || visited.has(g)) {
                    continue;
                }
                parent.set(g, current);
                if (g === target) {
                    const path: string[] = [];
                    let node: string | undefined = g;
                    while (node && node !== from) {
                        path.unshift(node);
                        node = parent.get(node);
                    }
                    return path;
                }
                visited.add(g);
                queue.push(g);
            }
        }
        return [];
    }

    private async _buildGrantPath(
        ctx: ServerContext,
        grant: PolicyGrantEntity,
        membershipChain: string[],
        queriedPermission: string,
    ): Promise<GrantPath | null> {
        const roleIri = grant.hasRole?.iri ?? null;
        const permissionIri = grant.hasPermission?.iri ?? null;
        const base: Omit<GrantPath, "roleInheritanceChain" | "permissionIri"> = {
            grantIri: grant.iri,
            grantedToPrincipalIri: grant.hasPrincipal?.iri ?? "",
            membershipChain,
            roleIri,
            roleName: roleIri ? await this._roleName(ctx, roleIri) : null,
            scopeIri: grant.hasScope?.iri ?? null,
            isDenial: grant.isDenial,
            expiresAt: grant.grantExpiresAt,
        };

        if (roleIri) {
            const { found, chain } = await this._findPermissionInRole(
                ctx,
                roleIri,
                queriedPermission,
                new Set(),
            );
            if (!found) {
                return null;
            }
            return { ...base, roleInheritanceChain: chain, permissionIri: null };
        }

        if (permissionIri) {
            const key = await this._permissionKey(ctx, permissionIri);
            if (key !== queriedPermission && key !== "*") {
                return null;
            }
            return { ...base, roleInheritanceChain: [], permissionIri };
        }

        return null;
    }

    private async _findPermissionInRole(
        ctx: ServerContext,
        roleIri: string,
        permission: string,
        visited: Set<string>,
    ): Promise<{ found: boolean; chain: string[] }> {
        if (visited.has(roleIri)) {
            return { found: false, chain: [] };
        }
        visited.add(roleIri);

        const grantQuads = await this._store.find(ctx, {
            subject: new IRI(roleIri),
            predicate: rbacGrantsIRI,
            graph: tenantGraph(ctx),
        });
        for (const q of grantQuads) {
            const permIri = iriValue(q.object);
            if (!permIri) {
                continue;
            }
            const key = await this._permissionKey(ctx, permIri);
            if (key === permission || key === "*") {
                return { found: true, chain: [] };
            }
        }

        const inheritQuads = await this._store.find(ctx, {
            subject: new IRI(roleIri),
            predicate: inheritsFromIRI,
            graph: tenantGraph(ctx),
        });
        for (const q of inheritQuads) {
            const parentIri = iriValue(q.object);
            if (!parentIri) {
                continue;
            }
            const { found, chain } = await this._findPermissionInRole(
                ctx,
                parentIri,
                permission,
                visited,
            );
            if (found) {
                return { found: true, chain: [parentIri, ...chain] };
            }
        }

        return { found: false, chain: [] };
    }

    private async _permissionKey(
        ctx: ServerContext,
        permissionIri: string,
    ): Promise<string | null> {
        const quads = await this._store.find(ctx, {
            subject: new IRI(permissionIri),
            predicate: permissionKeyIRI,
            graph: tenantGraph(ctx),
        });
        return quads.length > 0 ? (literalValue(quads[0].object) ?? null) : null;
    }

    private async _roleName(ctx: ServerContext, roleIri: string): Promise<string | null> {
        const quads = await this._store.find(ctx, {
            subject: new IRI(roleIri),
            predicate: roleNameIRI,
            graph: tenantGraph(ctx),
        });
        return quads.length > 0 ? (literalValue(quads[0].object) ?? null) : null;
    }

    private async _isGroup(ctx: ServerContext, iri: string): Promise<boolean> {
        const quads = await this._store.find(ctx, {
            subject: new IRI(iri),
            predicate: groupNameIRI,
            graph: tenantGraph(ctx),
        });
        return quads.length > 0;
    }
}
