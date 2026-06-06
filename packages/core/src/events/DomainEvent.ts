/** A domain event published to the event bus. */
export interface DomainEvent<T = unknown> {
    /** UUID v4 — unique across all events and all instances. */
    readonly id: string;
    /** IRI naming the event type (e.g. "urn:sys:core:auth:user.created"). */
    readonly type: string;
    /** IRI of the aggregate or component that emitted this event. */
    readonly source: string;
    /** Unix epoch milliseconds. */
    readonly timestamp: number;
    readonly payload: T;
}
