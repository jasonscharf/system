import type { DomainEvent, EventSubscription, IDomainEventBus } from "../events/index.js";

export type RpcKind = "command" | "query" | "operation";

/** Handler registered to process incoming commands, queries, or operations. */
export type RpcHandler = (payload: unknown) => Promise<unknown>;

/**
 * Unified messaging bus for the Tern platform.
 *
 * Combines pub/sub events (inherited from IDomainEventBus) with request/response
 * RPC for commands, queries, and operations.  Always non-optional on
 * ApplicationContext — there are no optional message facilities.
 *
 * Semantics
 * ─────────
 * Events    — fire-and-forget; no reply; fan-out to all subscribers.
 * Commands  — RPC; caller awaits void acknowledgement; implies mutation.
 * Queries   — RPC; caller awaits typed data; implies no mutation.
 * Operations — RPC; caller awaits typed data; implies mutation + return.
 *
 * Delivery guarantees depend on the implementation:
 *   InMemorySystemBus   — synchronous, in-process; suitable for tests.
 *   RedisSystemBus      — at-least-once; distributed; suitable for production.
 */
export interface ISystemBus extends IDomainEventBus {
    /**
     * Send a command and await void acknowledgement.
     * The handler may throw; the error is propagated as a rejected promise.
     */
    command(typeIri: string, payload?: unknown): Promise<void>;

    /**
     * Send a query and await a typed result.
     * The handler must return a value; throwing propagates as a rejection.
     */
    query<T = unknown>(typeIri: string, payload?: unknown): Promise<T>;

    /**
     * Send an operation and await a typed result.
     * Semantically identical to query but signals the handler mutates state.
     */
    operation<T = unknown>(typeIri: string, payload?: unknown): Promise<T>;

    /**
     * Register a handler for incoming commands, queries, or operations of a
     * given type IRI and kind.  Returns a Promise that resolves once the
     * handler is fully ready to receive messages (consumer group created, etc.).
     * Always await handle() before sending the first matching request.
     *
     * Only one handler per (typeIri, kind) pair is active at a time; a second
     * call replaces the first.
     */
    handle(typeIri: string, kind: RpcKind, fn: RpcHandler): Promise<void>;
}

export type { DomainEvent, EventSubscription, IDomainEventBus };
