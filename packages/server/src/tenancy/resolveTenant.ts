/**
 * Request-time tenant resolution.
 *
 * Turns an inbound request's Host header into the tenant id that scopes every
 * read and write for that request. The resolved id is stamped onto the request
 * ServerContext (`ctx.tenantId`), which is what routes all EntityStore /
 * EntityQuery / GraphQuery access into the tenant's named graph — without it a
 * request lands in DEFAULT_GRAPH and rooted traversal roots at null.
 *
 * Resolution is deterministic and does no IO: an explicit host mapping wins,
 * otherwise the request falls back to a single documented default tenant. This
 * keeps the sandbox single-tenant by default while remaining genuinely
 * multi-tenant capable — map real hostnames to tenants via `hostTenants` and
 * provision each of those tenant graphs.
 */

/**
 * The tenant every request resolves to when its host maps to no configured
 * tenant. The sandbox seeds RBAC and extension data into this tenant's graph at
 * boot, so a request stamped with it operates on real, authorized data (never
 * DEFAULT_GRAPH).
 */
export const DEFAULT_SANDBOX_TENANT = "sandbox";

export interface ResolveTenantArgs {
    /** The request Host header (may include a port), or null when unavailable. */
    host?: string | null;
    /**
     * Explicit host -> tenantId overrides. Keys are matched against the
     * normalized host (lowercased, port and trailing dot stripped). Lets a
     * deployment isolate real hostnames into their own tenant graphs.
     */
    hostTenants?: Record<string, string> | null;
    /** Fallback tenant id for an unmapped/absent host. Defaults to DEFAULT_SANDBOX_TENANT. */
    defaultTenant?: string;
}

/** Normalize a Host header to a stable key: lowercased, port and trailing dot stripped. */
export function normalizeHost(host: string): string {
    const trimmed = host.trim().toLowerCase().replace(/\.$/, "");
    const [name] = trimmed.split(":");
    return name ?? "";
}

/**
 * Resolve the tenant id for an inbound request from its Host header.
 *
 * Always returns a non-empty tenant id so a request context is never left
 * rootless: a configured `hostTenants` mapping wins, otherwise `defaultTenant`
 * (DEFAULT_SANDBOX_TENANT unless overridden).
 */
export function resolveTenantId(args: ResolveTenantArgs): string {
    const fallback = args.defaultTenant ?? DEFAULT_SANDBOX_TENANT;
    if (!args.host || !args.hostTenants) {
        return fallback;
    }
    const host = normalizeHost(args.host);
    if (!host) {
        return fallback;
    }
    return args.hostTenants[host] ?? fallback;
}
