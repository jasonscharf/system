import type { IDomainEventBus } from "@jasonscharf/core";
import type { EntityHandle, EntityRecord, EntitySchema, TernAggregate } from "@jasonscharf/entities";
import type { EntityStore } from "./EntityStore.js";
import type { ServerContext } from "./ServerContext.js";

/**
 * Abstract base repository for TernAggregate subclasses.
 *
 * Subclasses declare their schema, handles, and reconstruct() factory.
 * save() flushes pending changes to the store and optionally publishes
 * drained domain events to an IDomainEventBus.
 *
 * Example:
 *
 *   class UserRepository extends AggregateRepository<User> {
 *       get schema() { return UserSchema; }
 *       get handles(): EntityHandle[] | "*" { return "*"; }
 *       reconstruct(record: EntityRecord): User { return new User(record); }
 *   }
 */
export abstract class AggregateRepository<A extends TernAggregate> {
    constructor(protected readonly _store: EntityStore) {}

    abstract get schema(): EntitySchema;
    abstract get handles(): EntityHandle[] | "*";
    abstract reconstruct(record: EntityRecord): A;

    async findById(ctx: ServerContext, id: string): Promise<A | null> {
        const record = await this._store.findById(ctx, this.schema, id, this.handles);
        if (!record) {
            return null;
        }
        return this.reconstruct(record);
    }

    async save(ctx: ServerContext, aggregate: A, bus?: IDomainEventBus): Promise<void> {
        const changes = aggregate.drainChanges();
        for (const [handleId, patch] of changes) {
            const groupDef = this.schema.allGroups().find((g) => g.handle.id === handleId);
            if (!groupDef) {
                continue;
            }
            await this._store.updateGroup(ctx, this.schema, aggregate.id, groupDef.handle, patch);
        }
        const events = aggregate.drainEvents();
        if (bus) {
            for (const domainEvent of events) {
                await bus.publish(domainEvent);
            }
        }
    }
}
