// Browser-safe re-exports from @system/core.
//
// Excluded (server-only, require Node.js built-ins or knex):
//   hydration/providers/FileSource     — node:fs/promises
//   hydration/providers/DatabaseSource — knex / better-sqlite3
//
export * from "./auth/index.js";
export * from "./constants.js";
export * from "./hydration/providers/HttpSource.js";
export * from "./hydration/providers/SocketSource.js";
// Browser-safe hydration (TripleSource/Stream interfaces + fetch/socket providers)
export * from "./hydration/TripleSource.js";
export * from "./hydration/TripleStream.js";
export * from "./messages/SystemMessage.js";
export * from "./rdf/index.js";
export * from "./semantics/IRI.js";
export * from "./semantics/PrefixRegistry.js";
export * from "./util/async.js";
export * from "./util/binary.js";
export * from "./util/objects.js";
export * from "./util/random.js";
export * from "./util/uuid.js";
