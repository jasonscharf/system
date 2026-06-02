/**
 * Domain event bus integration tests.
 *
 * InMemoryEventBus: always runs.
 * RedisStreamEventBus: runs when TERN_REDIS_URL is set.
 */

import type { DomainEvent, IDomainEventBus } from "@jasonscharf/core";
import { InMemoryEventBus, RedisStreamEventBus } from "@jasonscharf/events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const USER_CREATED = "http://tern.dev/ns/auth/user.created";
const USER_UPDATED = "http://tern.dev/ns/auth/user.updated";

interface UserCreatedPayload {
    userId: string;
    email: string;
}

function makeEvent(type: string, payload: unknown, source = "http://tern.dev/ns/auth/system"): DomainEvent<unknown> {
    return {
        id: Math.random().toString(36).slice(2),
        type,
        source,
        timestamp: Date.now(),
        payload,
    };
}

// ── Shared suite ──────────────────────────────────────────────────────────────

function eventBusSuite(name: string, factory: () => IDomainEventBus) {
    describe(name, () => {
        let bus: IDomainEventBus;

        beforeEach(() => {
            bus = factory();
        });

        afterEach(async () => {
            await bus.close();
        });

        it("testSubscriberReceivesPublishedEvent", async () => {
            const received: DomainEvent<unknown>[] = [];
            await bus.subscribe(USER_CREATED, "test-sub", async (e) => { received.push(e); });

            const evt = makeEvent(USER_CREATED, { userId: "u1", email: "a@b.com" });
            await bus.publish(evt);

            await waitFor(() => received.length === 1);
            expect(received[0]?.id).toBe(evt.id);
            expect((received[0]?.payload as UserCreatedPayload).email).toBe("a@b.com");
        });

        it("testPublishWithNoSubscribersIsNoop", async () => {
            // Should not throw even though nobody is listening.
            await bus.publish(makeEvent(USER_CREATED, { userId: "u2" }));
        });

        it("testMultipleSubscriptionsEachReceiveEvent", async () => {
            const aReceived: string[] = [];
            const bReceived: string[] = [];

            await bus.subscribe(USER_CREATED, "sub-a", async (e) => {
                aReceived.push((e.payload as UserCreatedPayload).userId);
            });
            await bus.subscribe(USER_CREATED, "sub-b", async (e) => {
                bReceived.push((e.payload as UserCreatedPayload).userId);
            });

            await bus.publish(makeEvent(USER_CREATED, { userId: "u3", email: "c@d.com" }));

            await waitFor(() => aReceived.length === 1 && bReceived.length === 1);
            expect(aReceived).toEqual(["u3"]);
            expect(bReceived).toEqual(["u3"]);
        });

        it("testSubscriberOnlyReceivesMatchingType", async () => {
            const received: DomainEvent<unknown>[] = [];
            await bus.subscribe(USER_CREATED, "type-filter-sub", async (e) => { received.push(e); });

            await bus.publish(makeEvent(USER_UPDATED, { userId: "u4" }));
            await bus.publish(makeEvent(USER_CREATED, { userId: "u5", email: "e@f.com" }));

            await waitFor(() => received.length === 1);
            expect(received).toHaveLength(1);
            expect((received[0]?.payload as UserCreatedPayload).userId).toBe("u5");
        });

        it("testCancelStopsDelivery", async () => {
            const received: string[] = [];
            const sub = await bus.subscribe(USER_CREATED, "cancel-sub", async (e) => {
                received.push((e.payload as UserCreatedPayload).userId);
            });

            await bus.publish(makeEvent(USER_CREATED, { userId: "u6", email: "g@h.com" }));
            await waitFor(() => received.length === 1);

            await sub.cancel();

            await bus.publish(makeEvent(USER_CREATED, { userId: "u7", email: "i@j.com" }));
            await delay(50);

            expect(received).toHaveLength(1);
            expect(received[0]).toBe("u6");
        });

        it("testMultipleEventsDeliveredInOrder", async () => {
            const received: string[] = [];
            await bus.subscribe(USER_CREATED, "order-sub", async (e) => {
                received.push((e.payload as UserCreatedPayload).userId);
            });

            for (const id of ["u10", "u11", "u12"]) {
                await bus.publish(makeEvent(USER_CREATED, { userId: id, email: `${id}@x.com` }));
            }

            await waitFor(() => received.length === 3);
            expect(received).toEqual(["u10", "u11", "u12"]);
        });

        it("testSubscriptionMetadata", async () => {
            const sub = await bus.subscribe(USER_CREATED, "meta-sub", async () => {});
            expect(sub.typeIri).toBe(USER_CREATED);
            expect(sub.subscriptionName).toBe("meta-sub");
            await sub.cancel();
        });
    });
}

// ── Run suites ────────────────────────────────────────────────────────────────

eventBusSuite("InMemoryEventBus", () => new InMemoryEventBus());

if (process.env.TERN_REDIS_URL) {
    eventBusSuite(
        "RedisStreamEventBus",
        () => new RedisStreamEventBus(process.env.TERN_REDIS_URL!),
    );
} else {
    describe("RedisStreamEventBus (skipped — set TERN_REDIS_URL to enable)", () => {
        it("testSkipped", () => { /* no-op */ });
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
        if (Date.now() > deadline) {
            throw new Error("waitFor timed out");
        }
        await delay(20);
    }
}
