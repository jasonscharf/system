import type {
    ArgOf,
    CommandRegistry,
    EventRegistry,
    NameOf,
    OperationRegistry,
    OperationResultRegistry,
    QueryRegistry,
    QueryResultRegistry,
    ResultOf,
} from "./registry.js";

// ── Fluent exec handles ──────────────────────────────────────────────────────────
//
// Each `dispatch.<kind>(name)` call returns a handle whose `exec` takes the
// single JSON arg.  The arg type is looked up from the ambient registry by the
// string-literal name, so it flows through and autocompletes.

/** command / event: exec resolves to void on completion, or throws the Error. */
export interface VoidExec<A> {
    exec(arg: A): Promise<void>;
}

/** query / operation: exec resolves to the typed data set, or throws the Error. */
export interface DataExec<A, R> {
    exec(arg: A): Promise<R>;
}

// ── DispatchProvider ─────────────────────────────────────────────────────────────

/**
 * The global dispatch interface, implemented identically by clients and
 * servers.  Every kind is async and round-trips a reply so the awaited `exec()`
 * resolves on completion or throws the propagated Error — never fire-and-forget,
 * even for the void-returning command/event kinds.
 *
 * Call surface (single JSON arg, always):
 *
 *   await dispatch.command("view.activate").exec({ viewId });
 *   await dispatch.event("view.activated").exec({ viewId });
 *   const rows = await dispatch.query("view.list").exec({ filter });
 *   const res  = await dispatch.operation("view.create").exec({ name });
 */
export interface DispatchProvider {
    /** Begin a command dispatch for `name`; data is never returned. */
    command<N extends NameOf<CommandRegistry>>(name: N): VoidExec<ArgOf<CommandRegistry, N>>;

    /** Begin an event dispatch for `name`; data is never returned. */
    event<N extends NameOf<EventRegistry>>(name: N): VoidExec<ArgOf<EventRegistry, N>>;

    /** Begin a query dispatch for `name`; resolves to a data set. */
    query<N extends NameOf<QueryRegistry>>(
        name: N,
    ): DataExec<ArgOf<QueryRegistry, N>, ResultOf<QueryResultRegistry, N>>;

    /** Begin an operation dispatch for `name`; mutates and resolves to a data set. */
    operation<N extends NameOf<OperationRegistry>>(
        name: N,
    ): DataExec<ArgOf<OperationRegistry, N>, ResultOf<OperationResultRegistry, N>>;
}
