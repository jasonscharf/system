import type { IRI } from "@jasonscharf/core";
import type { EntitySchema } from "@jasonscharf/entities";
import type { ServerContext } from "./ServerContext.js";
import { tenantGraph } from "./tenancy.js";

/**
 * The containment topology — the parent→child edges that form the tenant-rooted
 * DAG. The same edges define the query path (down) and the authorization scope
 * chain (up). Schemas opt in by marking edges `containment: true`; they must be
 * registered here so scope-chain resolution knows which edges to follow.
 */
const _containment = new Map<string, IRI>();

/** Register the containment edges of one or more schemas (idempotent). */
export function registerTopology(...schemas: EntitySchema[]): void {
    for (const schema of schemas) {
        for (const def of Object.values(schema.edges ?? {})) {
            if (def.containment) {
                _containment.set(def.predicate.value, def.predicate);
            }
        }
    }
}

/** The registered containment edge predicates. */
export function containmentPredicates(): IRI[] {
    return [..._containment.values()];
}

/**
 * The authorization scope chain for a resource: the resource plus every ancestor
 * reachable by walking containment edges UP (inward) to the tenant root, within
 * the tenant graph. A grant scoped to any IRI in this chain authorizes the
 * resource — "moderator of SubForum A" covers every thread/post beneath A.
 *
 * Only containment edges are followed, so back-references (author, assignee, …)
 * never widen a principal's authority.
 */
export async function scopeChainFor(ctx: ServerContext, entityIri: string): Promise<string[]> {
    const predicates = containmentPredicates();
    if (predicates.length === 0) {
        return [entityIri];
    }
    const ancestors = await ctx.store.reachable(ctx, {
        roots: [{ value: entityIri } as IRI],
        predicates,
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
