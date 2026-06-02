/**
 * TernAggregate + AggregateRepository integration tests.
 *
 * Uses a real SQLite in-memory store.  No mocks.
 *
 * The "Widget" aggregate is defined inline — a minimal concrete aggregate
 * with two properties (name, color) and one domain event (renamed).
 */

import type { DomainEvent } from "@jasonscharf/core";
import { IRI } from "@jasonscharf/core";
import { createDataContext, TripleStore } from "@jasonscharf/data";
import {
    type EntityHandle,
    type EntityRecord,
    EntitySchema,
    handle,
    TernAggregate,
} from "@jasonscharf/entities";
import type { ServerContext } from "@jasonscharf/server";
import { AggregateRepository, defaultServerContext, EntityStore } from "@jasonscharf/server";
import type { Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { up as seedData } from "../../../data/src/migrations/001_init.js";

// ── Widget domain objects ─────────────────────────────────────────────────────

const NS = "http://tern.dev/test/widget/";
const WIDGET_IRI = new IRI(`${NS}Widget`);
const NAME_IRI = new IRI(`${NS}name`);
const COLOR_IRI = new IRI(`${NS}color`);
const CORE_HANDLE = handle("tern:widget.core");

// Extension PropGroup — simulates a third-party extension adding metadata
const META_HANDLE = handle("ext.widget.meta");
const TAGS_IRI = new IRI(`${NS}tags`);
const PRIORITY_IRI = new IRI(`${NS}priority`);

interface WidgetCoreProps extends Record<string, unknown> {
    name: string;
    color: string;
}

interface WidgetMetaProps extends Record<string, unknown> {
    tags: string;
    priority: number;
}

const WidgetSchema = new EntitySchema<WidgetCoreProps>({
    typeIRI: WIDGET_IRI,
    ns: NS,
    coreGroup: {
        handle: CORE_HANDLE,
        properties: { name: NAME_IRI, color: COLOR_IRI },
    },
});

// Register the extension group
WidgetSchema.register({
    handle: META_HANDLE,
    properties: { tags: TAGS_IRI, priority: PRIORITY_IRI },
});

class Widget extends TernAggregate<WidgetCoreProps> {
    static readonly RENAMED = "http://tern.dev/test/widget.renamed";

    get name(): string | undefined {
        return this._get(CORE_HANDLE, "name");
    }

    get color(): string | undefined {
        return this._get(CORE_HANDLE, "color");
    }

    // Secondary group access via _getFrom / _setOn
    get tags(): string | undefined {
        return this._getFrom<WidgetMetaProps, "tags">(META_HANDLE, "tags");
    }

    get priority(): number | undefined {
        return this._getFrom<WidgetMetaProps, "priority">(META_HANDLE, "priority");
    }

    setMeta(tags: string, priority: number): void {
        this._setOn<WidgetMetaProps, "tags">(META_HANDLE, "tags", tags);
        this._setOn<WidgetMetaProps, "priority">(META_HANDLE, "priority", priority);
    }

    rename(newName: string): void {
        const old = this.name;
        this._set(CORE_HANDLE, "name", newName);
        this._emit<{ from: string | undefined; to: string }>({
            id: Math.random().toString(36).slice(2),
            type: Widget.RENAMED,
            source: this.iri,
            timestamp: Date.now(),
            payload: { from: old, to: newName },
        });
    }

    recolor(newColor: string): void {
        this._set(CORE_HANDLE, "color", newColor);
    }
}

class WidgetRepository extends AggregateRepository<Widget> {
    get schema() {
        return WidgetSchema;
    }
    get handles(): EntityHandle[] | "*" {
        return "*";
    }
    reconstruct(record: EntityRecord): Widget {
        return new Widget(record);
    }
}

// ── Test setup ────────────────────────────────────────────────────────────────

describe("TernAggregate + AggregateRepository", () => {
    let knex: Knex;
    let store: TripleStore;
    let entityStore: EntityStore;
    let repo: WidgetRepository;
    let trx: Knex.Transaction;
    let ctx: ServerContext;

    beforeEach(async () => {
        knex = await createDataContext({ client: "sqlite", filename: ":memory:" });
        await seedData(knex);
        trx = await knex.transaction();
        ctx = { ...defaultServerContext, trx };
        store = new TripleStore(knex);
        entityStore = new EntityStore(store);
        repo = new WidgetRepository(entityStore);
    });

    afterEach(async () => {
        await trx.rollback();
        await knex.destroy();
    });

    // ── Unit behaviour (no store) ─────────────────────────────────────────────

    it("test get returns constructor props", () => {
        const record: EntityRecord = {
            id: "test-id",
            iri: `${NS}widget/test-id`,
            groups: { [CORE_HANDLE.id]: { name: "Sprocket", color: "blue" } },
        };
        const widget = new Widget(record);
        expect(widget.name).toBe("Sprocket");
        expect(widget.color).toBe("blue");
    });

    it("test set mutates in memory state", () => {
        const record: EntityRecord = {
            id: "test-id",
            iri: `${NS}widget/test-id`,
            groups: { [CORE_HANDLE.id]: { name: "Sprocket", color: "blue" } },
        };
        const widget = new Widget(record);
        widget.rename("Cog");
        expect(widget.name).toBe("Cog");
    });

    it("test is dirty after mutation", () => {
        const record: EntityRecord = {
            id: "test-id",
            iri: `${NS}widget/test-id`,
            groups: { [CORE_HANDLE.id]: { name: "A", color: "red" } },
        };
        const widget = new Widget(record);
        expect(widget.isDirty).toBe(false);
        widget.rename("B");
        expect(widget.isDirty).toBe(true);
    });

    it("test drain changes returns and clears changes", () => {
        const record: EntityRecord = {
            id: "test-id",
            iri: `${NS}widget/test-id`,
            groups: { [CORE_HANDLE.id]: { name: "A", color: "red" } },
        };
        const widget = new Widget(record);
        widget.rename("B");
        widget.recolor("green");

        const changes = widget.drainChanges();
        expect(changes.get(CORE_HANDLE.id)).toEqual({ name: "B", color: "green" });
        expect(widget.isDirty).toBe(false);
    });

    it("test domain event emitted on rename", () => {
        const record: EntityRecord = {
            id: "test-id",
            iri: `${NS}widget/test-id`,
            groups: { [CORE_HANDLE.id]: { name: "A", color: "red" } },
        };
        const widget = new Widget(record);
        widget.rename("B");

        const events = widget.drainEvents();
        expect(events).toHaveLength(1);
        expect(events[0]?.type).toBe(Widget.RENAMED);
        expect((events[0]?.payload as { to: string }).to).toBe("B");
    });

    it("test drain events clears buffer", () => {
        const record: EntityRecord = {
            id: "test-id",
            iri: `${NS}widget/test-id`,
            groups: { [CORE_HANDLE.id]: { name: "A", color: "red" } },
        };
        const widget = new Widget(record);
        widget.rename("B");
        widget.drainEvents();
        expect(widget.drainEvents()).toHaveLength(0);
    });

    it("test no event emitted for recolor", () => {
        const record: EntityRecord = {
            id: "test-id",
            iri: `${NS}widget/test-id`,
            groups: { [CORE_HANDLE.id]: { name: "A", color: "red" } },
        };
        const widget = new Widget(record);
        widget.recolor("green");
        expect(widget.drainEvents()).toHaveLength(0);
    });

    // ── Repository round-trips (real SQLite store) ────────────────────────────

    it("test find by id returns null for missing entity", async () => {
        const result = await repo.findById(ctx, "nonexistent");
        expect(result).toBeNull();
    });

    it("test find by id reconstitutes aggregate", async () => {
        const record = await entityStore.create(ctx, WidgetSchema, {
            name: "Sprocket",
            color: "blue",
        });

        const widget = await repo.findById(ctx, record.id);
        expect(widget).not.toBeNull();
        expect(widget?.id).toBe(record.id);
        expect(widget?.name).toBe("Sprocket");
        expect(widget?.color).toBe("blue");
    });

    it("test save persists changes", async () => {
        const record = await entityStore.create(ctx, WidgetSchema, {
            name: "Sprocket",
            color: "blue",
        });

        const widget = await repo.findById(ctx, record.id);
        if (widget === null) {
            throw new Error("expected widget");
        }
        widget.rename("Cog");
        await repo.save(ctx, widget);

        const reloaded = await repo.findById(ctx, record.id);
        expect(reloaded?.name).toBe("Cog");
        expect(reloaded?.color).toBe("blue");
    });

    it("test save publishes domain events to ctx bus", async () => {
        const { InMemorySystemBus } = await import("@jasonscharf/core");
        const bus = new InMemorySystemBus();
        const received: DomainEvent[] = [];
        await bus.subscribe(Widget.RENAMED, "test", async (e) => {
            received.push(e);
        });

        const ctxWithBus = { ...ctx, bus };
        const record = await entityStore.create(ctxWithBus, WidgetSchema, {
            name: "Sprocket",
            color: "blue",
        });

        const widget = await repo.findById(ctxWithBus, record.id);
        if (widget === null) {
            throw new Error("expected widget");
        }
        widget.rename("Cog");
        await repo.save(ctxWithBus, widget);

        expect(received).toHaveLength(1);
        expect(received[0]?.type).toBe(Widget.RENAMED);
        await bus.close();
    });

    it("test save with no pending changes is noop", async () => {
        const record = await entityStore.create(ctx, WidgetSchema, {
            name: "Sprocket",
            color: "blue",
        });

        const widget = await repo.findById(ctx, record.id);
        if (widget === null) {
            throw new Error("expected widget");
        }
        await repo.save(ctx, widget); // no changes — should not throw

        const reloaded = await repo.findById(ctx, record.id);
        expect(reloaded?.name).toBe("Sprocket");
    });

    it("test save no event bus drops events silently", async () => {
        const record = await entityStore.create(ctx, WidgetSchema, {
            name: "Sprocket",
            color: "blue",
        });

        const widget = await repo.findById(ctx, record.id);
        if (widget === null) {
            throw new Error("expected widget");
        }
        widget.rename("Cog");
        await repo.save(ctx, widget); // bus omitted — events drained silently
        expect(widget.isDirty).toBe(false);
    });

    // ── Secondary PropGroup (_getFrom / _setOn) ───────────────────────────────

    it("test set on and get from secondary group", () => {
        const record: EntityRecord = {
            id: "w1",
            iri: `${NS}widget/w1`,
            groups: {
                [CORE_HANDLE.id]: { name: "Bolt", color: "silver" },
            },
        };
        const widget = new Widget(record);

        // Initially no meta group data
        expect(widget.tags).toBeUndefined();
        expect(widget.priority).toBeUndefined();

        widget.setMeta("hardware,fastener", 1);

        expect(widget.tags).toBe("hardware,fastener");
        expect(widget.priority).toBe(1);
        expect(widget.isDirty).toBe(true);
    });

    it("test set on tracks changes per group", () => {
        const record: EntityRecord = {
            id: "w2",
            iri: `${NS}widget/w2`,
            groups: { [CORE_HANDLE.id]: { name: "Nut", color: "gold" } },
        };
        const widget = new Widget(record);
        widget.rename("NutV2");
        widget.setMeta("fastener", 5);

        const changes = widget.drainChanges();
        expect(changes.has(CORE_HANDLE.id)).toBe(true);
        expect(changes.has(META_HANDLE.id)).toBe(true);
        expect(changes.get(CORE_HANDLE.id)).toEqual({ name: "NutV2" });
        expect(changes.get(META_HANDLE.id)).toEqual({ tags: "fastener", priority: 5 });
    });

    it("test save persists secondary group changes", async () => {
        // First create the entity, then add the extension group
        const record = await entityStore.create(ctx, WidgetSchema, {
            name: "Washer",
            color: "zinc",
        });
        await entityStore.addGroup(ctx, WidgetSchema, record.id, META_HANDLE, {
            tags: "hardware",
            priority: 3,
        });

        const widget = await repo.findById(ctx, record.id);
        if (widget === null) {
            throw new Error("expected widget");
        }
        expect(widget.tags).toBe("hardware");
        expect(widget.priority).toBe(3);

        widget.setMeta("hardware,plumbing", 2);
        await repo.save(ctx, widget);

        const reloaded = await repo.findById(ctx, record.id);
        expect(reloaded?.tags).toBe("hardware,plumbing");
        expect(reloaded?.priority).toBe(2);
    });

    it("test save with unknown handle id in change set is no op", async () => {
        // If drainChanges() returns a handleId not registered on the schema,
        // AggregateRepository.save() must skip it silently rather than throw.
        // This protects against race conditions where an extension was removed
        // after data was loaded.
        const record = await entityStore.create(ctx, WidgetSchema, {
            name: "Rivet",
            color: "copper",
        });

        const widget = await repo.findById(ctx, record.id);
        if (widget === null) {
            throw new Error("expected widget");
        }

        // Manually inject a change for an unregistered handle
        (widget as unknown as { _changes: Map<string, Record<string, unknown>> })._changes.set(
            "unregistered.handle",
            { foo: "bar" },
        );

        // save() must not throw, and the real changes are still flushed
        widget.rename("RivetV2");
        await expect(repo.save(ctx, widget)).resolves.not.toThrow();

        const reloaded = await repo.findById(ctx, record.id);
        expect(reloaded).not.toBeNull();
        expect(reloaded?.name).toBe("RivetV2");
    });
});
