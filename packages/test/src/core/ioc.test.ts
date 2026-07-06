/**
 * TRN-267: IoC container — services resolve from the container and downstream
 * consumers can override any of them by rebinding before contexts/components
 * are created.
 *
 * Covers:
 *   - Default bindings: SystemBus → InMemorySystemBus (singleton),
 *     SystemLogger → ConsoleLogger.
 *   - defaultCtx members resolve lazily from the container.
 *   - buildServerContext populates bus/logger/entityStore from the container
 *     at build time; contexts built before an override keep what they had.
 *   - EntityStoreFactory override substitutes an EntityStore subclass
 *     everywhere EntityStores are created.
 *   - Boot-owned tokens (DataSource, SessionStore, auth repositories) throw
 *     ServiceNotBoundError before boot binds them and resolve afterwards.
 *   - Worker/auth components fall back to the container when service options
 *     are omitted.
 */

import {
    MemorySessionStore,
    SessionComponent,
    SessionStore,
    UserRepository,
    UserSessionRepository,
} from "@jasonscharf/auth";
import {
    bindService,
    ConsoleLogger,
    declareService,
    defaultCtx,
    InMemorySystemBus,
    type ISystemBus,
    resolveService,
    ServiceNotBoundError,
    SystemBus,
    SystemLogger,
    tryResolveService,
} from "@jasonscharf/core";
import { createDataContext, DataSource, TripleStore } from "@jasonscharf/data";
import { FlowContext } from "@jasonscharf/flow";
import {
    buildServerContext,
    createEntityStore,
    EntityStore,
    EntityStoreFactory,
    FieldCipherService,
} from "@jasonscharf/server";
import { FieldCipher } from "@jasonscharf/vaults";
import { JobScheduler } from "@jasonscharf/worker";
import type { Knex } from "knex";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { up as seedData } from "../../../data/src/migrations/001_init.js";
import { TEST_CIPHER } from "../auth/testCipher.js";

describe("IoC container", () => {
    let knex: Knex;
    let store: TripleStore;

    beforeAll(async () => {
        knex = await createDataContext({ client: "sqlite", filename: ":memory:" });
        await seedData(knex);
        store = new TripleStore(knex);
    });

    afterAll(async () => {
        await knex.destroy();
    });

    afterEach(() => {
        // Restore the platform defaults so tests stay order-independent.
        bindService(SystemBus, new InMemorySystemBus());
        bindService(SystemLogger, new ConsoleLogger());
        bindService(EntityStoreFactory, {
            create: (s, registry, cipher) => new EntityStore(s, registry, cipher),
        });
        declareService(DataSource);
        declareService(FieldCipherService);
        declareService(SessionStore);
        declareService(UserRepository);
        declareService(UserSessionRepository);
    });

    // ── Defaults ──────────────────────────────────────────────────────────────

    it("test system bus default is a singleton in-memory bus", () => {
        const a = resolveService(SystemBus);
        const b = resolveService(SystemBus);
        expect(a).toBeInstanceOf(InMemorySystemBus);
        expect(a).toBe(b);
    });

    it("test system logger default is a console logger", () => {
        expect(resolveService(SystemLogger)).toBeInstanceOf(ConsoleLogger);
    });

    it("test default ctx resolves members from the container", () => {
        expect(defaultCtx.bus).toBe(resolveService(SystemBus));
        expect(defaultCtx.logger).toBe(resolveService(SystemLogger));
    });

    // ── Override semantics ────────────────────────────────────────────────────

    it("test rebinding the bus overrides what every new context sees", async () => {
        const before = buildServerContext(store);

        class DownstreamBus extends InMemorySystemBus {}
        const custom: ISystemBus = new DownstreamBus();
        bindService(SystemBus, custom);

        expect(defaultCtx.bus).toBe(custom);

        const after = buildServerContext(store);
        expect(after.bus).toBe(custom);

        // Contexts capture their members at build time; earlier contexts keep
        // the binding that was in force when they were created.
        expect(before.bus).not.toBe(custom);

        // The overridden bus is live: a handler registered on it serves RPC
        // through the new context.
        await after.bus.handle("urn:sys:test:ioc:echo", "query", async (payload) => payload);
        const result = await after.bus.query("urn:sys:test:ioc:echo", { ok: true });
        expect(result).toEqual({ ok: true });
    });

    it("test rebinding the logger overrides what every new context sees", () => {
        const lines: string[] = [];
        const capture = {
            debug: (msg: string) => lines.push(`debug:${msg}`),
            info: (msg: string) => lines.push(`info:${msg}`),
            warn: (msg: string) => lines.push(`warn:${msg}`),
            error: (msg: string) => lines.push(`error:${msg}`),
        };
        bindService(SystemLogger, capture);

        const ctx = buildServerContext(store);
        ctx.logger?.info("hello");
        expect(lines).toEqual(["info:hello"]);
    });

    it("test explicit base members win over the container", () => {
        const explicitBus = new InMemorySystemBus();
        const ctx = buildServerContext(store, { bus: explicitBus });
        expect(ctx.bus).toBe(explicitBus);
        expect(ctx.bus).not.toBe(resolveService(SystemBus));
    });

    // ── EntityStoreFactory ────────────────────────────────────────────────────

    it("test entity store factory override substitutes a subclass everywhere", async () => {
        class DownstreamEntityStore extends EntityStore {}
        bindService(EntityStoreFactory, {
            create: (s, registry, cipher) => new DownstreamEntityStore(s, registry, cipher),
        });

        expect(createEntityStore(store)).toBeInstanceOf(DownstreamEntityStore);

        const ctx = buildServerContext(store);
        expect(ctx.entityStore).toBeInstanceOf(DownstreamEntityStore);

        // The substituted store is fully functional through the context.
        await ctx.tx(async (inner) => {
            expect(inner.entityStore).toBeInstanceOf(DownstreamEntityStore);
        });
    });

    // ── Boot-owned tokens ─────────────────────────────────────────────────────

    it("test resolving a declared but unbound service throws service not bound", () => {
        expect(() => resolveService(DataSource)).toThrow(ServiceNotBoundError);
        expect(tryResolveService(DataSource)).toBeNull();
    });

    it("test binding at boot makes the service resolvable", () => {
        bindService(DataSource, new DataSource(knex));
        expect(resolveService(DataSource).knex).toBe(knex);
        expect(tryResolveService(DataSource)?.knex).toBe(knex);
    });

    // ── Component fallback to the container ───────────────────────────────────

    it("test worker component resolves knex from the container when omitted", () => {
        expect(
            () => new JobScheduler({ context: new FlowContext(), isActive: () => false }),
        ).toThrow(ServiceNotBoundError);

        bindService(DataSource, new DataSource(knex));
        const scheduler = new JobScheduler({ context: new FlowContext(), isActive: () => false });
        expect(scheduler).toBeInstanceOf(JobScheduler);
    });

    it("test auth component resolves services from the container when omitted", () => {
        expect(() => new SessionComponent({ context: new FlowContext() })).toThrow(
            ServiceNotBoundError,
        );

        bindService(SessionStore, new MemorySessionStore());
        bindService(UserRepository, new UserRepository(store));
        bindService(UserSessionRepository, new UserSessionRepository(store));
        const component = new SessionComponent({ context: new FlowContext() });
        expect(component).toBeInstanceOf(SessionComponent);
    });

    // ── Field cipher fallback ─────────────────────────────────────────────────

    it("test context cipher falls back to the container binding", () => {
        const before = buildServerContext(store);
        expect(before.cipher).toBeUndefined();

        bindService(FieldCipherService, TEST_CIPHER);
        const after = buildServerContext(store);
        expect(after.cipher).toBe(TEST_CIPHER);

        const explicit = new FieldCipher({
            keys: { other: Buffer.alloc(32, 9) },
            currentKeyId: "other",
        });
        const withExplicit = buildServerContext(store, { cipher: explicit });
        expect(withExplicit.cipher).toBe(explicit);
    });

    it("test explicit component options win over the container", () => {
        bindService(SessionStore, new MemorySessionStore());
        bindService(UserRepository, new UserRepository(store));
        bindService(UserSessionRepository, new UserSessionRepository(store));

        // Passing explicit services must not consult the container at all —
        // rebinding afterwards does not affect the constructed component.
        const explicitStore = new MemorySessionStore();
        const component = new SessionComponent({
            context: new FlowContext(),
            sessionStore: explicitStore,
            users: new UserRepository(store),
            sessions: new UserSessionRepository(store),
        });
        expect(component).toBeInstanceOf(SessionComponent);
    });
});
