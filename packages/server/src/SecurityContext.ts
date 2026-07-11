// SecurityContext is defined once, in @jasonscharf/core, so the low-level
// dispatch contracts (HandlerContext, InvocationCtx, JobContext) can reference
// the same type without inverting the package layering (server -> app -> core).
// This module re-exports the canonical definition so the many intra-server
// relative importers keep resolving unchanged.

export type { SecurityContext } from "@jasonscharf/core";
export { anonymousSec, systemSec } from "@jasonscharf/core";
