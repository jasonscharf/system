import {
    groupNameIRI,
    IRI,
    inheritsFromIRI,
    memberOfIRI,
    permissionKeyIRI,
    rbacGrantsIRI,
    roleNameIRI,
} from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { ServerContext } from "@jasonscharf/server";
import type { AccessChecker } from "./AccessChecker.js";
import { RBAC_GRAPH } from "./constants.js";
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
     * e.g. [alice → staff, staff → admins] yields ["staff-iri", "admins-iri"].
     */
    membershipChain: string[];
    /** IRI of the role granted (null for direct-permission grants). */
    roleIri: string | null;
    /** Human-readable role name (null for direct-permission grants). */
    roleName: string | null;
    /**
     * Role inheritance path through which the target permission was reached.
     * Empty when the role grants the permission directly.
     * e.g. [owner → editor → viewer] yields ["editor-iri", "viewer-iri"].
     */
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

    /**
     * Returns the effective set of permission keys for the principal.
     * Alias for `AccessChecker.resolvePermissions` — convenience shorthand.
     */
    async listEffectivePermissions(
        ctx: ServerContext,
        principalIri: string,
        scopeIri?: string,
    ): Promise<Set<string>> {
        return this._checker.resolvePermissions(ctx, principalIri, scopeIri);
    }

    /**
     * Explains why a principal does or does not have a permission.
     *
     * Returns the final `allowed` decision and all grant paths that contributed
     * to it (both allows and denials) so you can see exactly where each
     * permission comes from.
     */
    async explain(
        ctx: ServerContext,
        opts: { principal: string; permission: string; scope?: string },
    ): Promise<PermissionExplanation> {
        const principals = await this._resolvePrincipalSet(ctx, opts.principal);
        const scopeChain = opts.scope ? await this._resolveScopeChain(ctx, opts.scope) : [];

        const rawGrants = await this._grants.findForPrincipals(
            ctx,
            Array.from(principals),
            scopeChain,
        );
        const active = rawGrants.filter(
            (g) => g.grantExpiresAt == null || g.grantExpiresAt.getTime() > Date.now(),
        );

        const allowedBy: GrantPath[] = [];
        const deniedBy: GrantPath[] = [];

        for (const grant of active) {
            const membershipChain = await this._membershipChain(
                ctx,
                opts.principal,
                grant.principalIri,
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
     * Returns all UserGroups the principal directly belongs to.
     * Pass `transitive: true` to also include groups-of-groups.
     */
    async listGroupMemberships(
        ctx: ServerContext,
        principalIri: string,
        opts?: { transitive?: boolean },
    ): Promise<UserGroupEntity[]> {
        if (opts?.transitive) {
            const allIris = await this._resolvePrincipalSet(ctx, principalIri);
            allIris.delete(principalIri); // remove the principal itself
            const groups: UserGroupEntity[] = [];
            for (const iri of allIris) {
                const g = await this._groups.findByIri(ctx, iri);
                if (g) {
                    groups.push(g);
                }
            }
            return groups;
        }

        const directIris = await this._groups.listGroupsForPrincipal(ctx, principalIri);
        const groups: UserGroupEntity[] = [];
        for (const iri of directIris) {
            const g = await this._groups.findByIri(ctx, iri);
            if (g) {
                groups.push(g);
            }
        }
        return groups;
    }

    /**
     * Returns all member IRIs of the given group.
     * Pass `transitive: true` to recursively expand nested groups.
     */
    async listGroupMembers(
        ctx: ServerContext,
        groupIri: string,
        opts?: { transitive?: boolean },
    ): Promise<string[]> {
        if (!opts?.transitive) {
            return this._groups.listMembers(ctx, groupIri);
        }

        // BFS — collect all principals reachable through MEMBER_OF edges pointing to this group
        const visited = new Set<string>();
        const queue = [groupIri];
        const members = new Set<string>();

        while (queue.length > 0) {
            const current = queue.shift();
            if (!current) {
                break;
            }
            const direct = await this._groups.listMembers(ctx, current);
            for (const m of direct) {
                if (members.has(m)) {
                    continue;
                }
                members.add(m);
                // If the member is itself a group, expand it too
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
     * Returns each UserGroup in the tenant along with its direct member IRIs.
     * Useful for rendering a group management UI.
     */
    async listGroupsWithMembers(
        ctx: ServerContext,
        tenantId?: string,
    ): Promise<UserGroupWithMembers[]> {
        const groups = await this._groups.listAll(ctx, tenantId);
        const result: UserGroupWithMembers[] = [];
        for (const g of groups) {
            const members = await this._groups.listMembers(ctx, g.iri);
            result.push({ ...g, members });
        }
        return result;
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
                predicate: memberOfIRI,
                graph: RBAC_GRAPH,
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
                predicate: { value: "http://tern.dev/ns/rbac/parentResource" } as IRI,
                graph: RBAC_GRAPH,
            });
            current = parentQuads.length > 0 ? (iriValue(parentQuads[0].object) ?? null) : null;
        }
        return chain;
    }

    /**
     * Returns the IRI chain between `from` and `target` through MEMBER_OF edges,
     * or an empty array if the grant is directly on `from`.
     */
    private async _membershipChain(
        ctx: ServerContext,
        from: string,
        target: string,
    ): Promise<string[]> {
        if (from === target) {
            return [];
        }
        // BFS tracking parent pointers
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
                predicate: memberOfIRI,
                graph: RBAC_GRAPH,
            });
            for (const q of quads) {
                const g = iriValue(q.object);
                if (!g || visited.has(g)) {
                    continue;
                }
                parent.set(g, current);
                if (g === target) {
                    // Reconstruct path
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

    /**
     * Builds a GrantPath for a single PolicyGrant, following role inheritance
     * to find the path through which the queried permission is reached.
     * Returns null if the grant does not contribute the queried permission.
     */
    private async _buildGrantPath(
        ctx: ServerContext,
        grant: PolicyGrantEntity,
        membershipChain: string[],
        queriedPermission: string,
    ): Promise<GrantPath | null> {
        const base: Omit<GrantPath, "roleInheritanceChain" | "permissionIri"> = {
            grantIri: grant.iri,
            grantedToPrincipalIri: grant.principalIri,
            membershipChain,
            roleIri: grant.roleIri,
            roleName: grant.roleIri ? await this._roleName(ctx, grant.roleIri) : null,
            scopeIri: grant.scopeIri,
            isDenial: grant.isDenial,
            expiresAt: grant.grantExpiresAt,
        };

        if (grant.roleIri) {
            const { found, chain } = await this._findPermissionInRole(
                ctx,
                grant.roleIri,
                queriedPermission,
                new Set(),
            );
            if (!found) {
                return null;
            }
            return { ...base, roleInheritanceChain: chain, permissionIri: null };
        }

        if (grant.permissionIri) {
            const key = await this._permissionKey(ctx, grant.permissionIri);
            if (key !== queriedPermission && key !== "*") {
                return null;
            }
            return { ...base, roleInheritanceChain: [], permissionIri: grant.permissionIri };
        }

        return null;
    }

    /**
     * DFS through role inheritance to find whether `permission` (or `*`) is
     * granted.  Returns the inheritance chain (list of role IRIs traversed).
     */
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
            graph: RBAC_GRAPH,
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
            graph: RBAC_GRAPH,
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
            graph: RBAC_GRAPH,
        });
        return quads.length > 0 ? (literalValue(quads[0].object) ?? null) : null;
    }

    private async _roleName(ctx: ServerContext, roleIri: string): Promise<string | null> {
        const quads = await this._store.find(ctx, {
            subject: new IRI(roleIri),
            predicate: roleNameIRI,
            graph: RBAC_GRAPH,
        });
        return quads.length > 0 ? (literalValue(quads[0].object) ?? null) : null;
    }

    private async _isGroup(ctx: ServerContext, iri: string): Promise<boolean> {
        const quads = await this._store.find(ctx, {
            subject: new IRI(iri),
            predicate: groupNameIRI,
            graph: RBAC_GRAPH,
        });
        return quads.length > 0;
    }
}
