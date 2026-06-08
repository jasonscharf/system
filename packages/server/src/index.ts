export { AggregateRepository } from "./AggregateRepository.js";
// ── Audit (append-only trail of sensitive actions) ──────────────────────────
export * from "./audit/index.js";
export type {
    CollectionViewItemRecord,
    CollectionViewOpts,
    CollectionViewRecord,
} from "./CollectionView.js";
export { CollectionViewStore } from "./CollectionView.js";
export type { FilterOp } from "./EntityQuery.js";
export { EntityQuery } from "./EntityQuery.js";
export type { EdgeInput, EntityInput } from "./EntityStore.js";
export { EntityStore } from "./EntityStore.js";
export { EntityValidationError } from "./EntityValidationError.js";
export { GraphQuery, type AttachUnder } from "./GraphQuery.js";
export { registerTopology, containmentPredicates, scopeChainFor } from "./topology.js";
export { ExtensionManager } from "./ExtensionManager.js";
export type { ExtensionRecord } from "./ExtensionRegistry.js";
export { ExtensionRegistry } from "./ExtensionRegistry.js";
export * from "./env.js";
// ── RBAC (moved in from the retired @jasonscharf/rbac package) ───────────────
export * from "./rbac/index.js";
export type { SecurityContext } from "./SecurityContext.js";
export { anonymousSec, systemSec } from "./SecurityContext.js";
export type { EntityLookup, GraphLookup, ServerContext } from "./ServerContext.js";
export { buildServerContext } from "./ServerContext.js";
// ── Superuser (membership of the system SYS_SUPERUSERS group) ────────────────
export * from "./superuser/index.js";
// ── Tenancy (Tenant and Organization entities) ──────────────────────────────
export * from "./tenancy/index.js";
export { tenantGraph, tenantGraphForInsert } from "./tenancy.js";
