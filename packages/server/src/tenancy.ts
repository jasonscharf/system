import { DEFAULT_GRAPH, type DefaultGraph, IRI, NS_ROOT } from "@jasonscharf/core";
import type { ServerContext } from "./ServerContext.js";

const TENANT_NS = `${NS_ROOT}tenant:`;

/**
 * Returns the named graph IRI for this tenant, optionally scoped to a domain.
 *
 *   tenantGraph(ctx)          → urn:sys:core:tenant:{id}
 *   tenantGraph(ctx, "labs")  → urn:sys:core:tenant:{id}/labs
 *
 * Returns null when ctx carries no tenantId (DEFAULT_GRAPH semantics).
 */
export function tenantGraph(ctx: ServerContext, domain?: string): IRI | null {
    if (!ctx.tenantId) {
        return null;
    }
    const base = `${TENANT_NS}${encodeURIComponent(ctx.tenantId)}`;
    if (!domain) {
        return new IRI(base);
    }
    return new IRI(`${base}/${encodeURIComponent(domain)}`);
}

/**
 * Returns the graph for Quad inserts (IRI | DefaultGraph).
 * Uses DEFAULT_GRAPH when no tenantId is set.
 */
export function tenantGraphForInsert(ctx: ServerContext, domain?: string): IRI | DefaultGraph {
    return tenantGraph(ctx, domain) ?? DEFAULT_GRAPH;
}
