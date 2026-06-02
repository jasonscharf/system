import type { DomainEvent, EventSubscription, IDomainEventBus } from "@jasonscharf/core";

type AnyHandler = (event: DomainEvent<unknown>) => Promise<void>;

/**
 * Single-process, synchronous event bus for development and testing.
 * Delivers to all subscriptions synchronously in publish() order.
 * Not safe for distributed use — use RedisStreamEventBus in production.
 */
export class InMemoryEventBus implements IDomainEventBus {
    private readonly _subs = new Map<string, Map<string, AnyHandler>>();

    async publish<T>(event: DomainEvent<T>): Promise<void> {
        const byName = this._subs.get(event.type);
        if (!byName) {
            return;
        }
        for (const handler of byName.values()) {
            try {
                await handler(event as DomainEvent<unknown>);
            } catch {
                // Subscriber errors must not abort delivery to other subscribers
                // or propagate through publish() — matches Redis Streams semantics.
            }
        }
    }

    async subscribe<T>(
        typeIri: string,
        subscriptionName: string,
        handler: (event: DomainEvent<T>) => Promise<void>,
    ): Promise<EventSubscription> {
        if (!this._subs.has(typeIri)) {
            this._subs.set(typeIri, new Map());
        }
        const byName = this._subs.get(typeIri) as Map<string, AnyHandler>;
        byName.set(subscriptionName, handler as AnyHandler);

        return {
            typeIri,
            subscriptionName,
            cancel: async () => {
                byName.delete(subscriptionName);
            },
        };
    }

    async close(): Promise<void> {
        this._subs.clear();
    }
}
