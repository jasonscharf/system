import { DEFAULT_GRAPH, type DefaultGraph, IRI } from "@jasonscharf/core";
import type { ServerContext } from "./ServerContext.js";

const TENANT_NS = "http://tern.dev/ns/tenant/";

/**
 * Returns the graph for QuadPattern filtering (find / delete):
 *   - null → DEFAULT_GRAPH (no tenantId; backwards-compatible)
 *   - IRI  → tenant-scoped named graph
 */
export function tenantGraph(ctx: ServerContext): IRI | null {
    if (!ctx.tenantId) {
        return null;
    }
    return new IRI(`${TENANT_NS}${encodeURIComponent(ctx.tenantId)}`);
}

/**
 * Returns the graph for Quad inserts (IRI | DefaultGraph).
 * Uses the DEFAULT_GRAPH sentinel when no tenantId is set.
 */
export function tenantGraphForInsert(ctx: ServerContext): IRI | DefaultGraph {
    return tenantGraph(ctx) ?? DEFAULT_GRAPH;
}
