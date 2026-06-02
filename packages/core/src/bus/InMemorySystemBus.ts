import type { DomainEvent, EventSubscription } from "../events/index.js";
import type { ISystemBus, RpcHandler, RpcKind } from "./ISystemBus.js";

type AnyHandler = (event: DomainEvent<unknown>) => Promise<void>;

function rpcKey(typeIri: string, kind: RpcKind): string {
    return `${kind}::${typeIri}`;
}

/**
 * Single-process, synchronous messaging bus for development and testing.
 *
 * - Events:     delivered synchronously to all subscribers in publish() order.
 * - Commands/queries/operations: dispatched synchronously to the registered
 *   handler; rejects if no handler is registered.
 * - Subscriber errors never propagate through publish() (mirrors Redis
 *   semantics so tests don't need to special-case the implementation).
 */
export class InMemorySystemBus implements ISystemBus {
    private readonly _eventSubs = new Map<string, Map<string, AnyHandler>>();
    private readonly _rpcHandlers = new Map<string, RpcHandler>();

    // ── Events ────────────────────────────────────────────────────────────────

    async publish<T>(event: DomainEvent<T>): Promise<void> {
        const byName = this._eventSubs.get(event.type);
        if (!byName) {
            return;
        }
        for (const handler of byName.values()) {
            try {
                await handler(event as DomainEvent<unknown>);
            } catch {
                // Subscriber errors must not abort delivery to other subscribers.
            }
        }
    }

    async subscribe<T>(
        typeIri: string,
        subscriptionName: string,
        handler: (event: DomainEvent<T>) => Promise<void>,
    ): Promise<EventSubscription> {
        if (!this._eventSubs.has(typeIri)) {
            this._eventSubs.set(typeIri, new Map());
        }
        (this._eventSubs.get(typeIri) as Map<string, AnyHandler>).set(
            subscriptionName,
            handler as AnyHandler,
        );
        return {
            typeIri,
            subscriptionName,
            cancel: async () => {
                this._eventSubs.get(typeIri)?.delete(subscriptionName);
            },
        };
    }

    // ── RPC ───────────────────────────────────────────────────────────────────

    async command(typeIri: string, payload?: unknown): Promise<void> {
        await this._dispatch(typeIri, "command", payload);
    }

    async query<T = unknown>(typeIri: string, payload?: unknown): Promise<T> {
        return this._dispatch(typeIri, "query", payload) as Promise<T>;
    }

    async operation<T = unknown>(typeIri: string, payload?: unknown): Promise<T> {
        return this._dispatch(typeIri, "operation", payload) as Promise<T>;
    }

    handle(typeIri: string, kind: RpcKind, fn: RpcHandler): Promise<void> {
        this._rpcHandlers.set(rpcKey(typeIri, kind), fn);
        return Promise.resolve();
    }

    private async _dispatch(typeIri: string, kind: RpcKind, payload: unknown): Promise<unknown> {
        const fn = this._rpcHandlers.get(rpcKey(typeIri, kind));
        if (!fn) {
            throw new Error(`No handler registered for ${kind} ${typeIri}`);
        }
        return fn(payload);
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    async close(): Promise<void> {
        this._eventSubs.clear();
        this._rpcHandlers.clear();
    }
}
