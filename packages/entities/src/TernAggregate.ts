import type { DomainEvent } from "@jasonscharf/core";
import type { EntityRecord } from "./EntityRecord.js";
import type { EntityHandle } from "./Handle.js";

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
 *       get email() { return this._get(CORE_HANDLE, "email"); }
 *       changeEmail(email: string) {
 *           this._set(CORE_HANDLE, "email", email);
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
    private readonly _changes = new Map<string, Record<string, unknown>>();

    constructor(protected readonly _record: EntityRecord) {
        this.id = _record.id;
        this.iri = _record.iri;
    }

    // ── Property access ───────────────────────────────────────────────────────

    protected _get<K extends keyof TCoreProps>(
        h: EntityHandle,
        prop: K,
    ): TCoreProps[K] | undefined {
        return this._record.groups[h.id]?.[prop as string] as TCoreProps[K] | undefined;
    }

    /** Access a property from a secondary (extension) group with its own type. */
    protected _getFrom<TProps extends Record<string, unknown>, K extends keyof TProps>(
        h: EntityHandle,
        prop: K,
    ): TProps[K] | undefined {
        return this._record.groups[h.id]?.[prop as string] as TProps[K] | undefined;
    }

    // ── Mutations ─────────────────────────────────────────────────────────────

    protected _set<K extends keyof TCoreProps>(
        h: EntityHandle,
        prop: K,
        value: TCoreProps[K],
    ): void {
        if (!this._changes.has(h.id)) {
            this._changes.set(h.id, {});
        }
        this._changes.get(h.id)![prop as string] = value;
        // Mirror into the record so subsequent _get calls see the updated value.
        if (!this._record.groups[h.id]) {
            this._record.groups[h.id] = {};
        }
        this._record.groups[h.id]![prop as string] = value;
    }

    protected _setOn<TProps extends Record<string, unknown>, K extends keyof TProps>(
        h: EntityHandle,
        prop: K,
        value: TProps[K],
    ): void {
        if (!this._changes.has(h.id)) {
            this._changes.set(h.id, {});
        }
        this._changes.get(h.id)![prop as string] = value;
        if (!this._record.groups[h.id]) {
            this._record.groups[h.id] = {};
        }
        this._record.groups[h.id]![prop as string] = value;
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
    drainChanges(): ReadonlyMap<string, Record<string, unknown>> {
        const snapshot = new Map(this._changes);
        this._changes.clear();
        return snapshot;
    }

    get isDirty(): boolean {
        return this._changes.size > 0;
    }
}
