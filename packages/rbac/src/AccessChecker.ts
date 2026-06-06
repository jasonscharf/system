import {
    actsForIRI,
    hasParentIRI,
    IRI,
    inheritsFromIRI,
    isMemberOfIRI,
    permissionKeyIRI,
    rbacGrantsIRI,
} from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import { type ServerContext, systemSec } from "@jasonscharf/server";
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

        const grants = await this._grants.findForPrincipals(ctx, systemSec, {
            principalIris: Array.from(principals),
            scopeIris: scopeChain,
        });
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

        const grants = await this._grants.findForPrincipals(ctx, systemSec, {
            principalIris: Array.from(principals),
            scopeIris: scopeChain,
        });
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
     * to via `rbac:memberOf` edges — one recursive-CTE reachability query (cycle-safe),
     * not a per-hop BFS.
     */
    private async _resolvePrincipalSet(
        ctx: ServerContext,
        principalIri: string,
    ): Promise<Set<string>> {
        const reached = await this._store.reachable(ctx, {
            roots: [new IRI(principalIri)],
            predicates: [isMemberOfIRI],
            direction: "out",
            graph: RBAC_GRAPH,
        });
        const set = new Set(reached.map((i) => i.value));
        set.add(principalIri); // always include the caller, even with no membership edges
        return set;
    }

    /**
     * Returns the resource itself plus every ancestor reachable via
     * `rbac:parentResource` — the scope chain used to match grants on any ancestor.
     * One recursive-CTE query (cycle-safe), not a per-hop parent walk.
     */
    private async _resolveScopeChain(ctx: ServerContext, scopeIri: string): Promise<string[]> {
        const reached = await this._store.reachable(ctx, {
            roots: [new IRI(scopeIri)],
            predicates: [hasParentIRI],
            direction: "out",
            graph: RBAC_GRAPH,
        });
        const chain = reached.map((i) => i.value);
        if (!chain.includes(scopeIri)) {
            chain.push(scopeIri);
        }
        return chain;
    }

    /**
     * Expand a list of grants into a flat set of permission keys.  Role grants
     * expand through their `rbac:inheritsFrom` closure (one reachability query for
     * all granted roles at once); role→permission edges and permission→key lookups
     * are then resolved in single batched round-trips — no per-role/per-permission
     * query loops.
     */
    private async _expandGrantsToKeys(
        ctx: ServerContext,
        grants: PolicyGrantEntity[],
    ): Promise<Set<string>> {
        const roleIris = grants.map((g) => g.hasRole?.iri).filter((x): x is string => x != null);
        const permIris = new Set<string>(
            grants.map((g) => g.hasPermission?.iri).filter((x): x is string => x != null),
        );

        // 1. inheritsFrom closure over all granted roles (includes the roles themselves).
        const allRoles = new Set<string>(roleIris);
        if (roleIris.length > 0) {
            const closure = await this._store.reachable(ctx, {
                roots: roleIris.map((r) => new IRI(r)),
                predicates: [inheritsFromIRI],
                direction: "out",
                graph: RBAC_GRAPH,
            });
            for (const r of closure) {
                allRoles.add(r.value);
            }
        }

        // 2. Batched role→permission edges for every role in the closure.
        if (allRoles.size > 0) {
            const bySubject = await this._store.findForSubjects(
                ctx,
                [...allRoles].map((r) => new IRI(r)),
                RBAC_GRAPH,
            );
            for (const quads of bySubject.values()) {
                for (const q of quads) {
                    if ((q.predicate as IRI).value === rbacGrantsIRI.value) {
                        const permIri = iriValue(q.object);
                        if (permIri) {
                            permIris.add(permIri);
                        }
                    }
                }
            }
        }

        // 3. Batched permission→key resolution.
        return this._permissionKeys(ctx, [...permIris]);
    }

    /** Resolve a set of Permission IRIs to their permissionKey literals in one round-trip. */
    private async _permissionKeys(
        ctx: ServerContext,
        permissionIris: string[],
    ): Promise<Set<string>> {
        const keys = new Set<string>();
        if (permissionIris.length === 0) {
            return keys;
        }
        const bySubject = await this._store.findForSubjects(
            ctx,
            permissionIris.map((p) => new IRI(p)),
            RBAC_GRAPH,
        );
        for (const quads of bySubject.values()) {
            for (const q of quads) {
                if ((q.predicate as IRI).value === permissionKeyIRI.value) {
                    const key = literalValue(q.object);
                    if (key) {
                        keys.add(key);
                    }
                }
            }
        }
        return keys;
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
