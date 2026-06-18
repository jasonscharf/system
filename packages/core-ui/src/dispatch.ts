// TODO(TRN-229): replace this local seam with @tern/core-dispatch (the real
// commands/events layer). core-dispatch is not yet built; core-ui defines the
// MINIMAL contract it depends on here so composition can wire commands, queries,
// operations, and events today and swap the implementation in behind this
// interface later.

/**
 * The four message kinds a dispatch can carry. Mirrors the platform's
 * Command/Query/Operation/Event taxonomy (all derive from Request/Message).
 */
export type DispatchKind = "command" | "query" | "operation" | "event";

/**
 * Argument + result signature for a request-style message (query/operation).
 * Used as the value type in the ambient SystemQueries / SystemOperations
 * registries so a message name carries both its arg and its result type.
 */
export interface RequestSig<TArg = unknown, TResult = unknown> {
    readonly arg: TArg;
    readonly result: TResult;
}

// ── Ambient message registries ──────────────────────────────────────────────
// These interfaces map a message NAME to its argument (and, for requests, its
// result) type. They ship empty save for a string index signature, so an
// unknown name resolves to `unknown` while a name an extension has declared
// resolves to its specific type (indexed access prefers the declared property
// over the index signature). Extensions add their messages by declaration
// merging:
//
//   declare module "@jasonscharf/core-ui" {
//       interface SystemCommands { "nav.go": { to: string }; }
//       interface SystemQueries  { "user.find": RequestSig<{ id: string }, User>; }
//   }
//
// The typing then flows through `command`/`query`/`operation`/`on`/`event` to
// the handle's `exec` (or the event payload), so callers get checked args.

/** name → command argument type. */
export interface SystemCommands {
    [name: string]: unknown;
}

/** name → event payload type. */
export interface SystemEvents {
    [name: string]: unknown;
}

/** name → query { arg; result }. */
export interface SystemQueries {
    [name: string]: RequestSig;
}

/** name → operation { arg; result }. */
export interface SystemOperations {
    [name: string]: RequestSig;
}

/**
 * A command invocation handle. Obtained from `Dispatch.command(name)` and
 * executed with a single serializable argument. Commands are imperative: they
 * ask the system to do something and resolve when it is done (or rejected).
 */
export interface CommandHandle<TArg = unknown> {
    exec(arg: TArg): Promise<void>;
}

/**
 * A request invocation handle for queries and operations: like a command, but
 * its `exec` resolves with a serializable result.
 */
export interface RequestHandle<TArg = unknown, TResult = unknown> {
    exec(arg: TArg): Promise<TResult>;
}

/**
 * Listener registered against a named event. Receives the serializable event
 * payload. Returns void; throwing is reported to the dispatcher.
 */
export type EventListener<TPayload = unknown> = (payload: TPayload) => void;

/**
 * Unsubscribe handle returned from `Dispatch.on`. Calling it removes the
 * listener. Idempotent.
 */
export type Unsubscribe = () => void;

/**
 * The minimal dispatch contract core-ui composition depends on.
 *
 * - `command(name)` resolves a named command into an executable handle.
 * - `query(name)` / `operation(name)` resolve a named request into a handle
 *    whose `exec` resolves with a result.
 * - `on(name, listener)` subscribes to a named event, returning an unsubscribe.
 * - `event(name, payload)` emits a named event to all subscribers.
 *
 * Every method is keyed off the ambient registries above, so an extension that
 * augments `SystemCommands` (etc.) gets fully-typed args/results at the call
 * site without core-ui knowing those messages exist.
 *
 * This is intentionally tiny: it is the seam between contributed UI (views,
 * menus) and the application's behavior layer. When @tern/core-dispatch lands,
 * an adapter implementing this interface replaces InMemoryDispatch.
 */
export interface Dispatch {
    command<K extends keyof SystemCommands>(name: K): CommandHandle<SystemCommands[K]>;
    query<K extends keyof SystemQueries>(
        name: K,
    ): RequestHandle<SystemQueries[K]["arg"], SystemQueries[K]["result"]>;
    operation<K extends keyof SystemOperations>(
        name: K,
    ): RequestHandle<SystemOperations[K]["arg"], SystemOperations[K]["result"]>;
    on<K extends keyof SystemEvents>(
        name: K,
        listener: EventListener<SystemEvents[K]>,
    ): Unsubscribe;
    event<K extends keyof SystemEvents>(name: K, payload: SystemEvents[K]): void;
}

/**
 * Implementation of a named command. Registered on InMemoryDispatch and run
 * when a CommandHandle for the same name is executed.
 */
export type CommandImpl<TArg = unknown> = (arg: TArg) => Promise<void> | void;

/**
 * Implementation of a named request (query/operation). Returns a serializable
 * result that flows back through the RequestHandle's `exec`.
 */
export type RequestImpl<TArg = unknown, TResult = unknown> = (
    arg: TArg,
) => Promise<TResult> | TResult;

/**
 * A real, in-process implementation of the Dispatch seam.
 *
 * This is NOT a mock: it is a fully working dispatcher used by tests and the
 * test-app to exercise command/query/operation/event round-trips. Unknown
 * commands, queries, and operations reject loudly so wiring mistakes surface;
 * an event with no listeners is a silent no-op, mirroring the platform's
 * "empty result" stance for fire-and-forget signals.
 *
 * `register` / `registerQuery` / `registerOperation` take an explicit argument
 * (and result) type, which is the ergonomic wiring side; the `command` /
 * `query` / `operation` accessors are keyed off the ambient registries, which
 * is the typed consumer side.
 */
export class InMemoryDispatch implements Dispatch {
    private readonly _commands = new Map<string, CommandImpl>();
    private readonly _queries = new Map<string, RequestImpl>();
    private readonly _operations = new Map<string, RequestImpl>();
    private readonly _listeners = new Map<string, Set<EventListener>>();

    /**
     * Register a command implementation under a name. Re-registering replaces
     * the previous implementation.
     */
    register<TArg = unknown>(name: string, impl: CommandImpl<TArg>): void {
        this._commands.set(name, impl as CommandImpl);
    }

    /** Register a query implementation under a name. */
    registerQuery<TArg = unknown, TResult = unknown>(
        name: string,
        impl: RequestImpl<TArg, TResult>,
    ): void {
        this._queries.set(name, impl as RequestImpl);
    }

    /** Register an operation implementation under a name. */
    registerOperation<TArg = unknown, TResult = unknown>(
        name: string,
        impl: RequestImpl<TArg, TResult>,
    ): void {
        this._operations.set(name, impl as RequestImpl);
    }

    command<K extends keyof SystemCommands>(name: K): CommandHandle<SystemCommands[K]> {
        return {
            exec: async (arg): Promise<void> => {
                const impl = this._commands.get(name as string);
                if (impl === undefined) {
                    throw new Error(`No command registered for "${String(name)}"`);
                }
                await impl(arg);
            },
        };
    }

    query<K extends keyof SystemQueries>(
        name: K,
    ): RequestHandle<SystemQueries[K]["arg"], SystemQueries[K]["result"]> {
        return this._request(this._queries, "query", name as string);
    }

    operation<K extends keyof SystemOperations>(
        name: K,
    ): RequestHandle<SystemOperations[K]["arg"], SystemOperations[K]["result"]> {
        return this._request(this._operations, "operation", name as string);
    }

    on<K extends keyof SystemEvents>(
        name: K,
        listener: EventListener<SystemEvents[K]>,
    ): Unsubscribe {
        let set = this._listeners.get(name as string);
        if (set === undefined) {
            set = new Set<EventListener>();
            this._listeners.set(name as string, set);
        }
        set.add(listener as EventListener);
        return () => {
            set.delete(listener as EventListener);
        };
    }

    event<K extends keyof SystemEvents>(name: K, payload: SystemEvents[K]): void {
        const set = this._listeners.get(name as string);
        if (set === undefined) {
            return;
        }
        for (const listener of set) {
            listener(payload);
        }
    }

    /** True if a command implementation is registered for the name. */
    hasCommand(name: string): boolean {
        return this._commands.has(name);
    }

    /** Number of listeners subscribed to an event name. */
    listenerCount(name: string): number {
        const set = this._listeners.get(name);
        return set === undefined ? 0 : set.size;
    }

    private _request<TArg, TResult>(
        registry: Map<string, RequestImpl>,
        kind: "query" | "operation",
        name: string,
    ): RequestHandle<TArg, TResult> {
        return {
            exec: async (arg): Promise<TResult> => {
                const impl = registry.get(name);
                if (impl === undefined) {
                    throw new Error(`No ${kind} registered for "${name}"`);
                }
                return (await impl(arg)) as TResult;
            },
        };
    }
}
