import type { EntityRecord, EntitySchema, TernAggregate } from "@jasonscharf/entities";
import type { EntityStore } from "./EntityStore.js";
import type { ServerContext } from "./ServerContext.js";

/**
 * Abstract base repository for TernAggregate subclasses.
 *
 * Subclasses declare their schema and reconstruct() factory.
 * save() flushes pending changes to the store and publishes drained domain
 * events through ctx.bus.
 *
 * Example:
 *
 *   class WidgetRepository extends AggregateRepository<Widget> {
 *       get schema() { return WidgetSchema; }
 *       reconstruct(record: EntityRecord): Widget { return new Widget(record); }
 *   }
 */
export abstract class AggregateRepository<A extends TernAggregate> {
    constructor(protected readonly _store: EntityStore) {}

    abstract get schema(): EntitySchema;
    abstract reconstruct(record: EntityRecord): A;

    async findById(ctx: ServerContext, id: string): Promise<A | null> {
        const record = await this._store.findById(ctx, this.schema, id);
        if (!record) {
            return null;
        }
        return this.reconstruct(record);
    }

    async save(ctx: ServerContext, aggregate: A): Promise<void> {
        const changes = aggregate.drainChanges();
        if (Object.keys(changes).length > 0) {
            await this._store.update(ctx, this.schema, aggregate.id, changes);
        }
        for (const domainEvent of aggregate.drainEvents()) {
            await ctx.bus.publish(domainEvent);
        }
    }
}
