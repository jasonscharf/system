import type { IRI } from "@jasonscharf/core";
import type { EntitySchema } from "@jasonscharf/entities";
import type { ServerContext } from "./ServerContext.js";
import { DomainSchema, OrgSchema, TenantSchema } from "./tenancy/schemas.js";
import { tenantGraph } from "./tenancy.js";

/**
 * The containment topology — the parent→child edges that form the tenant-rooted
 * DAG. The same edges define the query path (down) and the authorization scope
 * chain (up). Schemas opt in by marking edges `containment: true`.
 *
 * The topology is a value derived from schemas, carried on the ServerContext
 * (`ctx.containment`). It is deliberately NOT process-wide mutable state: it used
 * to be a module-level Map populated by import-time side effects, which made the
 * authorization scope chain depend on module import order (TRN-627). A context
 * built without the tenancy backbone would silently resolve to the resource
 * alone, quietly narrowing every scope check.
 */

/**
 * The core containment backbone every ServerContext carries:
 *
 *   Tenant --hasOrg--> Org --hasMember--> User
 *   Tenant --hasDomain--> Domain
 *
 * buildServerContext always composes these, so the tenant root is reachable by
 * construction rather than by whoever happened to import a module first.
 */
export const CORE_CONTAINMENT_SCHEMAS: readonly EntitySchema[] = [
    TenantSchema,
    OrgSchema,
    DomainSchema,
];

/**
 * The containment edge predicates declared by `schemas`, deduplicated and in
 * declaration order. Pure: same input, same output, no ambient state.
 */
export function containmentPredicatesOf(schemas: readonly EntitySchema[]): IRI[] {
    const predicates = new Map<string, IRI>();
    for (const schema of schemas) {
        for (const def of Object.values(schema.edges ?? {})) {
            if (def.containment) {
                predicates.set(def.predicate.value, def.predicate);
            }
        }
    }
    return [...predicates.values()];
}

/**
 * The authorization scope chain for a resource: the resource plus every ancestor
 * reachable by walking containment edges UP (inward) to the tenant root, within
 * the tenant graph. A grant scoped to any IRI in this chain authorizes the
 * resource — "moderator of SubForum A" covers every thread/post beneath A.
 *
 * Only containment edges are followed, so back-references (author, assignee, …)
 * never widen a principal's authority.
 *
 * Throws when the context carries no topology: with nothing to walk, the chain
 * would collapse to the resource alone and silently narrow the scope check.
 * Authorization cannot be evaluated against an unknown topology, so it fails
 * loudly instead.
 */
export async function scopeChainFor(ctx: ServerContext, entityIri: string): Promise<string[]> {
    const predicates = ctx.containment;
    if (predicates.length === 0) {
        throw new Error(
            `Cannot resolve the authorization scope chain for "${entityIri}": this context carries no containment topology. ` +
                "Build the context with buildServerContext so the core backbone is present.",
        );
    }
    const ancestors = await ctx.store.reachable(ctx, {
        roots: [{ value: entityIri } as IRI],
        predicates: [...predicates],
        direction: "in",
        graph: tenantGraph(ctx),
        includeRoots: true,
    });
    const chain = ancestors.map((i) => i.value);
    if (!chain.includes(entityIri)) {
        chain.push(entityIri);
    }
    return chain;
}
