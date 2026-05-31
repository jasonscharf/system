import {
    actsForIRI,
    IRI,
    inheritsFromIRI,
    memberOfIRI,
    parentResourceIRI,
    permissionKeyIRI,
    rbacGrantsIRI,
} from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { ServerContext } from "@jasonscharf/server";
import { RBAC_GRAPH, WILDCARD_PERMISSION } from "./constants.js";
import type { PolicyGrantRepository } from "./repository/PolicyGrantRepository.js";
import { iriValue, literalValue } from "./repository/util.js";
import type { CheckOptions, PolicyGrantEntity } from "./types.js";

/**
 * Authorization evaluator.
 *
 * Evaluation order:
 *   1. Resolve effective principals: the caller + all transitive group memberships.
 *   2. Resolve scope chain: the target resource → parents → tenant (or empty for system-wide).
 *   3. Collect all non-expired PolicyGrants for (principals × scopes ∪ no-scope).
 *   4. Expand roles (with inheritance) and direct permission grants into permission key sets.
 *   5. Apply denials: a denial at any scope blocks the permission even if an allow exists.
 *   6. Wildcard "*" in the allow set grants everything.
 */
export class AccessChecker {
    private readonly _store: TripleStore;
    private readonly _grants: PolicyGrantRepository;

    constructor(store: TripleStore, grants: PolicyGrantRepository) {
        this._store = store;
        this._grants = grants;
    }

    /**
     * Returns true if the principal has the given permission in the given scope.
     *
     * When `actingAs` is provided the caller must have an `rbac:actsFor` edge to
     * `actingAs`; the permission check is then performed as if the caller were
     * `actingAs`.
     */
    async check(ctx: ServerContext, opts: CheckOptions): Promise<boolean> {
        let effectivePrincipal = opts.principal;

        if (opts.actingAs) {
            const canImpersonate = await this._canActAs(ctx, opts.principal, opts.actingAs);
            if (!canImpersonate) {
                return false;
            }
            effectivePrincipal = opts.actingAs;
        }

        const principals = await this._resolvePrincipalSet(ctx, effectivePrincipal);
        const scopeChain = opts.scope ? await this._resolveScopeChain(ctx, opts.scope) : [];

        const grants = await this._grants.findForPrincipals(
            ctx,
            Array.from(principals),
            scopeChain,
        );
        const active = this._filterExpired(grants);

        const allows = active.filter((g) => !g.isDenial);
        const denials = active.filter((g) => g.isDenial);

        const deniedKeys = await this._expandGrantsToKeys(ctx, denials);
        if (deniedKeys.has(WILDCARD_PERMISSION) || deniedKeys.has(opts.permission)) {
            return false;
        }

        const allowedKeys = await this._expandGrantsToKeys(ctx, allows);
        return allowedKeys.has(WILDCARD_PERMISSION) || allowedKeys.has(opts.permission);
    }

    /**
     * Returns the complete set of permission keys available to the principal in the
     * given scope. Useful for building UI visibility or bulk authorization decisions.
     */
    async resolvePermissions(
        ctx: ServerContext,
        principalIri: string,
        scopeIri?: string,
    ): Promise<Set<string>> {
        const principals = await this._resolvePrincipalSet(ctx, principalIri);
        const scopeChain = scopeIri ? await this._resolveScopeChain(ctx, scopeIri) : [];

        const grants = await this._grants.findForPrincipals(
            ctx,
            Array.from(principals),
            scopeChain,
        );
        const active = this._filterExpired(grants);

        const allows = active.filter((g) => !g.isDenial);
        const denials = active.filter((g) => g.isDenial);

        const allowedKeys = await this._expandGrantsToKeys(ctx, allows);
        const deniedKeys = await this._expandGrantsToKeys(ctx, denials);

        for (const key of deniedKeys) {
            allowedKeys.delete(key);
        }
        return allowedKeys;
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    /**
     * Returns the principal IRI itself plus all group IRIs it transitively belongs
     * to via `rbac:memberOf` edges. BFS — handles nested groups.
     */
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

    /**
     * Returns the resource IRI chain: the resource itself, then each parent
     * resource, up to the root. Also appends the tenant IRI if found.
     * The result is used to match grants whose scope is any ancestor of the target.
     */
    private async _resolveScopeChain(ctx: ServerContext, scopeIri: string): Promise<string[]> {
        const chain: string[] = [];
        const visited = new Set<string>();
        let current: string | null = scopeIri;

        while (current && !visited.has(current)) {
            visited.add(current);
            chain.push(current);

            const parentQuads = await this._store.find(ctx, {
                subject: new IRI(current),
                predicate: parentResourceIRI,
                graph: RBAC_GRAPH,
            });
            current = parentQuads.length > 0 ? (iriValue(parentQuads[0].object) ?? null) : null;
        }

        return chain;
    }

    /**
     * Expand a list of grants into a flat set of permission keys, resolving role
     * permissions (with transitive inheritance) and direct permission grants.
     */
    private async _expandGrantsToKeys(
        ctx: ServerContext,
        grants: PolicyGrantEntity[],
    ): Promise<Set<string>> {
        const keys = new Set<string>();

        for (const grant of grants) {
            if (grant.roleIri) {
                const roleKeys = await this._expandRoleToKeys(ctx, grant.roleIri, new Set());
                for (const k of roleKeys) {
                    keys.add(k);
                }
            }
            if (grant.permissionIri) {
                const key = await this._permissionKey(ctx, grant.permissionIri);
                if (key) {
                    keys.add(key);
                }
            }
        }

        return keys;
    }

    /**
     * Collect all permission keys granted by a role, following `rbac:inheritsFrom`
     * edges transitively. Cycle guard via `visited` set.
     */
    private async _expandRoleToKeys(
        ctx: ServerContext,
        roleIri: string,
        visited: Set<string>,
    ): Promise<Set<string>> {
        if (visited.has(roleIri)) {
            return new Set();
        }
        visited.add(roleIri);

        const keys = new Set<string>();

        // Direct grants on this role
        const grantQuads = await this._store.find(ctx, {
            subject: new IRI(roleIri),
            predicate: rbacGrantsIRI,
            graph: RBAC_GRAPH,
        });
        for (const q of grantQuads) {
            const permIri = iriValue(q.object);
            if (permIri) {
                const key = await this._permissionKey(ctx, permIri);
                if (key) {
                    keys.add(key);
                }
            }
        }

        // Inherited permissions
        const inheritQuads = await this._store.find(ctx, {
            subject: new IRI(roleIri),
            predicate: inheritsFromIRI,
            graph: RBAC_GRAPH,
        });
        for (const q of inheritQuads) {
            const parentIri = iriValue(q.object);
            if (parentIri) {
                const parentKeys = await this._expandRoleToKeys(ctx, parentIri, visited);
                for (const k of parentKeys) {
                    keys.add(k);
                }
            }
        }

        return keys;
    }

    /** Fetch the permissionKey literal for a Permission IRI. */
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

    /** Verify that `fromIri` has an `rbac:actsFor` edge pointing to `toIri`. */
    private async _canActAs(ctx: ServerContext, fromIri: string, toIri: string): Promise<boolean> {
        const quads = await this._store.find(ctx, {
            subject: new IRI(fromIri),
            predicate: actsForIRI,
            object: new IRI(toIri),
            graph: RBAC_GRAPH,
        });
        return quads.length > 0;
    }

    /** Filter out grants that have expired. */
    private _filterExpired(grants: PolicyGrantEntity[]): PolicyGrantEntity[] {
        const now = Date.now();
        return grants.filter((g) => g.grantExpiresAt == null || g.grantExpiresAt.getTime() > now);
    }
}
