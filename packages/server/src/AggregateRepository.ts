import type { EntityHandle, EntityRecord, EntitySchema, TernAggregate } from "@jasonscharf/entities";
import type { EntityStore } from "./EntityStore.js";
import type { ServerContext } from "./ServerContext.js";

/**
 * Abstract base repository for TernAggregate subclasses.
 *
 * Subclasses declare their schema, handles, and reconstruct() factory.
 * save() flushes pending changes to the store and publishes drained domain
 * events through ctx.bus.
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

    async save(ctx: ServerContext, aggregate: A): Promise<void> {
        const changes = aggregate.drainChanges();
        for (const [handleId, patch] of changes) {
            const groupDef = this.schema.allGroups().find((g) => g.handle.id === handleId);
            if (!groupDef) {
                continue;
            }
            await this._store.updateGroup(ctx, this.schema, aggregate.id, groupDef.handle, patch);
        }
        for (const domainEvent of aggregate.drainEvents()) {
            await ctx.bus.publish(domainEvent);
        }
    }
}
