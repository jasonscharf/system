// ── Transport (events + in-process) ─────────────────────────────────────────────

// ── Typed dispatch layer (rehomed from @tern/core-dispatch, TRN-450) ─────────────
//
// Isomorphic commands / events / queries / operations over an ISystemBus, with a
// declaration-merged typing registry.  The DispatchProvider (client) and
// DispatchHost (server) are implemented identically in-process and across a
// queue; only the injected bus differs.
export * from "./BusDispatchProvider.js";
export * from "./DefRegistry.js";
export * from "./DispatchHost.js";
export * from "./DispatchProvider.js";
export * from "./InMemoryEventBus.js";
export * from "./iri.js";
export * from "./RedisStreamEventBus.js";
export * from "./RedisSystemBus.js";
export * from "./registry.js";
export * from "./runner.js";
export * from "./types.js";
