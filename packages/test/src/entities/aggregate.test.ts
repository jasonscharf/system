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
import { EntitySchema, handle, type EntityHandle, type EntityRecord } from "@jasonscharf/entities";
import { TernAggregate } from "@jasonscharf/entities";
import { AggregateRepository, EntityStore, defaultServerContext } from "@jasonscharf/server";
import type { ServerContext } from "@jasonscharf/server";
import { InMemoryEventBus } from "@jasonscharf/events";
import type { Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { up as seedData } from "../../../data/src/migrations/001_init.js";

// ── Widget domain objects ─────────────────────────────────────────────────────

const NS = "http://tern.dev/test/widget/";
const WIDGET_IRI = new IRI(`${NS}Widget`);
const NAME_IRI = new IRI(`${NS}name`);
const COLOR_IRI = new IRI(`${NS}color`);
const CORE_HANDLE = handle("tern:widget.core");

interface WidgetCoreProps {
    name: string;
    color: string;
}

const WidgetSchema = new EntitySchema<WidgetCoreProps>({
    typeIRI: WIDGET_IRI,
    ns: NS,
    coreGroup: {
        handle: CORE_HANDLE,
        properties: { name: NAME_IRI, color: COLOR_IRI },
    },
});

class Widget extends TernAggregate<WidgetCoreProps> {
    static readonly RENAMED = "http://tern.dev/test/widget.renamed";

    get name(): string | undefined {
        return this._get(CORE_HANDLE, "name");
    }

    get color(): string | undefined {
        return this._get(CORE_HANDLE, "color");
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
    get schema() { return WidgetSchema; }
    get handles(): EntityHandle[] | "*" { return "*"; }
    reconstruct(record: EntityRecord): Widget { return new Widget(record); }
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
        ctx = { trx };
        store = new TripleStore(knex);
        entityStore = new EntityStore(store);
        repo = new WidgetRepository(entityStore);
    });

    afterEach(async () => {
        await trx.rollback();
        await knex.destroy();
    });

    // ── Unit behaviour (no store) ─────────────────────────────────────────────

    it("testGetReturnsConstructorProps", () => {
        const record: EntityRecord = {
            id: "test-id",
            iri: `${NS}widget/test-id`,
            groups: { [CORE_HANDLE.id]: { name: "Sprocket", color: "blue" } },
        };
        const widget = new Widget(record);
        expect(widget.name).toBe("Sprocket");
        expect(widget.color).toBe("blue");
    });

    it("testSetMutatesInMemoryState", () => {
        const record: EntityRecord = {
            id: "test-id",
            iri: `${NS}widget/test-id`,
            groups: { [CORE_HANDLE.id]: { name: "Sprocket", color: "blue" } },
        };
        const widget = new Widget(record);
        widget.rename("Cog");
        expect(widget.name).toBe("Cog");
    });

    it("testIsDirtyAfterMutation", () => {
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

    it("testDrainChangesReturnsAndClearsChanges", () => {
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

    it("testDomainEventEmittedOnRename", () => {
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

    it("testDrainEventsClearsBuffer", () => {
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

    it("testNoEventEmittedForRecolor", () => {
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

    it("testFindByIdReturnsNullForMissingEntity", async () => {
        const result = await repo.findById(ctx, "nonexistent");
        expect(result).toBeNull();
    });

    it("testFindByIdReconstitutesAggregate", async () => {
        const record = await entityStore.create(ctx, WidgetSchema, {
            name: "Sprocket",
            color: "blue",
        });

        const widget = await repo.findById(ctx, record.id);
        expect(widget).not.toBeNull();
        expect(widget!.id).toBe(record.id);
        expect(widget!.name).toBe("Sprocket");
        expect(widget!.color).toBe("blue");
    });

    it("testSavePersistsChanges", async () => {
        const record = await entityStore.create(ctx, WidgetSchema, {
            name: "Sprocket",
            color: "blue",
        });

        const widget = (await repo.findById(ctx, record.id))!;
        widget.rename("Cog");
        await repo.save(ctx, widget);

        const reloaded = await repo.findById(ctx, record.id);
        expect(reloaded!.name).toBe("Cog");
        expect(reloaded!.color).toBe("blue");
    });

    it("testSavePublishesDomainEventsToEventBus", async () => {
        const record = await entityStore.create(ctx, WidgetSchema, {
            name: "Sprocket",
            color: "blue",
        });

        const bus = new InMemoryEventBus();
        const received: DomainEvent[] = [];
        await bus.subscribe(Widget.RENAMED, "test", async (e) => { received.push(e); });

        const widget = (await repo.findById(ctx, record.id))!;
        widget.rename("Cog");
        await repo.save(ctx, widget, bus);

        expect(received).toHaveLength(1);
        expect(received[0]?.type).toBe(Widget.RENAMED);
        await bus.close();
    });

    it("testSaveWithNoPendingChangesIsNoop", async () => {
        const record = await entityStore.create(ctx, WidgetSchema, {
            name: "Sprocket",
            color: "blue",
        });

        const widget = (await repo.findById(ctx, record.id))!;
        await repo.save(ctx, widget); // no changes — should not throw

        const reloaded = await repo.findById(ctx, record.id);
        expect(reloaded!.name).toBe("Sprocket");
    });

    it("testSaveNoEventBusDropsEventsSilently", async () => {
        const record = await entityStore.create(ctx, WidgetSchema, {
            name: "Sprocket",
            color: "blue",
        });

        const widget = (await repo.findById(ctx, record.id))!;
        widget.rename("Cog");
        await repo.save(ctx, widget); // bus omitted — events drained silently
        expect(widget.isDirty).toBe(false);
    });
});
