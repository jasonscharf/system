// TODO(TRN-229): replace this local seam with @tern/core-dispatch (the real
// commands/events layer). core-dispatch is not yet built; core-ui defines the
// MINIMAL contract it depends on here so composition can wire commands and
// events today and swap the implementation in behind this interface later.

/**
 * A command invocation handle. Obtained from `Dispatch.command(name)` and
 * executed with a single serializable argument. Commands are imperative: they
 * ask the system to do something and resolve when it is done (or rejected).
 */
export interface CommandHandle<TArg = unknown> {
    exec(arg: TArg): Promise<void>;
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
 * - `on(name, listener)` subscribes to a named event, returning an unsubscribe.
 * - `event(name, payload)` emits a named event to all subscribers.
 *
 * This is intentionally tiny: it is the seam between contributed UI (views,
 * menus) and the application's behavior layer. When @tern/core-dispatch lands,
 * an adapter implementing this interface replaces InMemoryDispatch.
 */
export interface Dispatch {
    command<TArg = unknown>(name: string): CommandHandle<TArg>;
    on<TPayload = unknown>(name: string, listener: EventListener<TPayload>): Unsubscribe;
    event<TPayload = unknown>(name: string, payload: TPayload): void;
}

/**
 * Implementation of a named command. Registered on InMemoryDispatch and run
 * when a CommandHandle for the same name is executed.
 */
export type CommandImpl<TArg = unknown> = (arg: TArg) => Promise<void> | void;

/**
 * A real, in-process implementation of the Dispatch seam.
 *
 * This is NOT a mock: it is a fully working dispatcher used by tests and the
 * test-app to exercise command/event round-trips. Unknown commands resolve to
 * a no-op handle that rejects on exec, mirroring the "empty result" semantics
 * the platform favors while still surfacing wiring mistakes loudly.
 */
export class InMemoryDispatch implements Dispatch {
    private readonly _commands = new Map<string, CommandImpl>();
    private readonly _listeners = new Map<string, Set<EventListener>>();

    /**
     * Register a command implementation under a name. Re-registering replaces
     * the previous implementation.
     */
    register<TArg = unknown>(name: string, impl: CommandImpl<TArg>): void {
        this._commands.set(name, impl as CommandImpl);
    }

    command<TArg = unknown>(name: string): CommandHandle<TArg> {
        return {
            exec: async (arg: TArg): Promise<void> => {
                const impl = this._commands.get(name);
                if (impl === undefined) {
                    throw new Error(`No command registered for "${name}"`);
                }
                await impl(arg);
            },
        };
    }

    on<TPayload = unknown>(name: string, listener: EventListener<TPayload>): Unsubscribe {
        let set = this._listeners.get(name);
        if (set === undefined) {
            set = new Set<EventListener>();
            this._listeners.set(name, set);
        }
        set.add(listener as EventListener);
        return () => {
            set.delete(listener as EventListener);
        };
    }

    event<TPayload = unknown>(name: string, payload: TPayload): void {
        const set = this._listeners.get(name);
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
}
