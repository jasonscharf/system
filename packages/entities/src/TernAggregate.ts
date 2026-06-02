import type { DomainEvent } from "@jasonscharf/core";
import type { EntityRecord } from "./EntityRecord.js";

/**
 * Base class for rich domain aggregates backed by an EntityRecord.
 *
 * Subclasses expose typed properties via _get/_set and emit domain events via
 * _emit.  Mutations are buffered as a change set; the AggregateRepository
 * flushes them to the store on save() and forwards domain events to the bus.
 *
 * Example:
 *
 *   class User extends TernAggregate<{ email: string }> {
 *       get email() { return this._get("email"); }
 *       changeEmail(email: string) {
 *           this._set("email", email);
 *           this._emit({ id: newId(), type: UserIRIs.emailChanged, source: this.iri,
 *                        timestamp: Date.now(), payload: { email } });
 *       }
 *   }
 */
export abstract class TernAggregate<
    TCoreProps extends Record<string, unknown> = Record<string, unknown>,
> {
    readonly id: string;
    readonly iri: string;

    private readonly _events: DomainEvent[] = [];
    private readonly _changes: Record<string, unknown> = {};

    constructor(protected readonly _record: EntityRecord) {
        this.id = _record.id;
        this.iri = _record.iri;
    }

    // ── Property access ───────────────────────────────────────────────────────

    protected _get<K extends keyof TCoreProps>(prop: K): TCoreProps[K] | undefined {
        return this._record.props[prop as string] as TCoreProps[K] | undefined;
    }

    // ── Mutations ─────────────────────────────────────────────────────────────

    protected _set<K extends keyof TCoreProps>(prop: K, value: TCoreProps[K]): void {
        this._changes[prop as string] = value;
        this._record.props[prop as string] = value;
    }

    // ── Domain events ─────────────────────────────────────────────────────────

    protected _emit<T>(event: DomainEvent<T>): void {
        this._events.push(event as DomainEvent);
    }

    /** Returns and clears all pending domain events (called by AggregateRepository). */
    drainEvents(): DomainEvent[] {
        const snapshot = [...this._events];
        this._events.length = 0;
        return snapshot;
    }

    /** Returns and clears all pending property changes (called by AggregateRepository). */
    drainChanges(): Record<string, unknown> {
        const snapshot = { ...this._changes };
        for (const key of Object.keys(this._changes)) {
            delete this._changes[key];
        }
        return snapshot;
    }

    get isDirty(): boolean {
        return Object.keys(this._changes).length > 0;
    }
}
