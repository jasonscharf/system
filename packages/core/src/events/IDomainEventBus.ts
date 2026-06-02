import type { DomainEvent } from "./DomainEvent.js";

/** Returned by subscribe(); call cancel() to stop receiving events. */
export interface EventSubscription {
    readonly typeIri: string;
    readonly subscriptionName: string;
    cancel(): Promise<void>;
}

/**
 * Platform event bus.  Publish/subscribe over domain event IRIs.
 *
 * Implementations must be safe for multiple concurrent processes:
 *   - All instances sharing a subscriptionName compete for each message
 *     (exactly-once delivery within the group — load balanced).
 *   - Different subscriptionNames each receive every message (fan-out).
 */
export interface IDomainEventBus {
    publish<T>(event: DomainEvent<T>): Promise<void>;

    subscribe<T>(
        typeIri: string,
        subscriptionName: string,
        handler: (event: DomainEvent<T>) => Promise<void>,
    ): Promise<EventSubscription>;

    close(): Promise<void>;
}
