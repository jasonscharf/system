import type { SecurityContext } from "@jasonscharf/core";
import type { JsonValue } from "./registry.js";

// ── Dispatch kinds ─────────────────────────────────────────────────────────────
//
// The four isomorphic message kinds.  Their semantics:
//
//   command   — async, returns void | Error, NEVER data ("do this").
//   event     — async, returns void | Error, NEVER data ("this happened").
//   query     — async, returns a data set; runs a `reducers` pipeline after the
//               main invocation sequence; implies NO mutation.
//   operation — async, returns a data set; like query but implies mutation.

export type DispatchKind = "command" | "event" | "query" | "operation";

/**
 * A module-ref / loader-syntax string that points at a callable.
 *
 * Grammar (see resolveModuleRef): `module://<specifier>[#<member>][?<query>]`.
 * Each named dispatch entry runs a sequence of these, in order, asynchronously.
 */
export type ModuleRef = string;

/**
 * Shared shape for every dispatch definition.  A definition is the config for a
 * single named entry (e.g. "view.activate") and describes the ordered sequence
 * of async invocations to run when the entry is dispatched.
 *
 * Definitions MUST be JSON-serializable: they are sourced from composed
 * app/extension config (RDF/YAML) and may themselves cross a queue.
 */
export interface DispatchDefBase {
    /** The fully-qualified dispatch name, e.g. "view.activate". */
    readonly name: string;
    /** The kind this definition declares. */
    readonly kind: DispatchKind;
    /**
     * Ordered module-refs to invoke.  Each receives `(ctx)` where `ctx` carries
     * the single JSON arg plus the accumulated results of prior invocations.
     * All invocations are async.
     */
    readonly invocations: readonly ModuleRef[];
    /**
     * Optional human-readable description of what this entry does.  Surfaced by
     * `describe()` so a generic client (CLI, WebSockets, Switchyard) can present
     * the dispatch surface.  JSON-serializable.
     */
    readonly description?: string;
    /**
     * Optional JSON-Schema object describing the single `args` object this entry
     * accepts.  Surfaced by `describe()` so a client can build/validate inputs.
     * JSON-serializable (may cross a queue).
     */
    readonly argSchema?: JsonValue;
}

/** Command definition — void-returning; no data, no reducers. */
export interface CommandDef extends DispatchDefBase {
    readonly kind: "command";
}

/** Event definition — void-returning; no data, no reducers. */
export interface EventDef extends DispatchDefBase {
    readonly kind: "event";
}

/**
 * Query definition — returns data.  After the main `invocations` sequence runs,
 * each module-ref in `reducers` runs in order to fold the collected results
 * into the final returned data set.
 */
export interface QueryDef extends DispatchDefBase {
    readonly kind: "query";
    /** Reducer module-refs, run in order after the main sequence. */
    readonly reducers: readonly ModuleRef[];
    /**
     * Optional JSON-Schema object describing the data set this query returns.
     * Surfaced by `describe()`.  JSON-serializable.
     */
    readonly resultSchema?: JsonValue;
}

/** Operation definition — like a query, but for mutations. */
export interface OperationDef extends DispatchDefBase {
    readonly kind: "operation";
    /** Reducer module-refs, run in order after the main sequence. */
    readonly reducers: readonly ModuleRef[];
    /**
     * Optional JSON-Schema object describing the data set this operation returns.
     * Surfaced by `describe()`.  JSON-serializable.
     */
    readonly resultSchema?: JsonValue;
}

export type DispatchDef = CommandDef | EventDef | QueryDef | OperationDef;

// ── Invocation context ──────────────────────────────────────────────────────────

/**
 * The single argument threaded through every invocation in a sequence.
 *
 * `arg`     — the single JSON arg passed to `exec(arg)` (immutable for the run).
 * `results` — append-only list of values returned by prior invocations in this
 *             run; the runner pushes each non-null return onto it.
 * `name`    — the dispatch name being run.
 * `kind`    — the dispatch kind being run.
 * `sec`     — the security principal for this run.  The runner defaults it to
 *             `anonymousSec` so unauthenticated dispatch is unauthenticated by
 *             an explicit value, never by an absent field; an invocation that
 *             requires a real principal must fail closed when it is anonymous.
 * `tenantId`— the tenant this run is scoped to, or null for cross-tenant /
 *             system runs.  Both fields are JSON-serializable.
 */
export interface InvocationCtx {
    readonly name: string;
    readonly kind: DispatchKind;
    readonly arg: unknown;
    readonly results: unknown[];
    readonly sec: SecurityContext;
    readonly tenantId: string | null;
}

/**
 * The reducer context: the same shape as InvocationCtx, plus the in-progress
 * accumulator.  A reducer returns the next accumulator value.
 */
export interface ReducerCtx extends InvocationCtx {
    /** The current reduced value (starts as the `results` array). */
    readonly acc: unknown;
}

/** Signature every invocation module-ref must satisfy. */
export type Invocation = (ctx: InvocationCtx) => Promise<unknown>;

/** Signature every reducer module-ref must satisfy. */
export type Reducer = (ctx: ReducerCtx) => Promise<unknown>;

// ── Runtime discovery (dispatch manifest) ────────────────────────────────────────
//
// A generic client (the future Tern CLI, WebSockets, Switchyard) needs to
// enumerate and document the whole dispatch surface at runtime so it can
// auto-build its command tree.  `describe()` projects each registered def into
// one of these flat, JSON-serializable entries.  It deliberately omits the
// module-refs / reducers (server-internal wiring) and exposes only the public
// contract: the name, kind, and optional human/machine documentation.

/**
 * One entry in the runtime dispatch manifest — the public, JSON-serializable
 * documentation of a single registered dispatch def.  `resultSchema` is only
 * present for query/operation defs that declare one.
 */
export interface DispatchManifestEntry {
    /** The kind this entry declares. */
    readonly kind: DispatchKind;
    /** The fully-qualified dispatch name, e.g. "view.activate". */
    readonly name: string;
    /** Human-readable description, when the def declared one. */
    readonly description?: string;
    /** JSON-Schema for the single `args` object, when the def declared one. */
    readonly argSchema?: JsonValue;
    /** JSON-Schema for the returned data set (query/operation only). */
    readonly resultSchema?: JsonValue;
}
