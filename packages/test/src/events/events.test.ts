/**
 * Domain event bus integration tests.
 *
 * InMemoryEventBus: always runs.
 * RedisStreamEventBus: runs when TERN_REDIS_URL is set.
 *
 * Redis tests use a unique streamPrefix per test so each test gets a
 * completely isolated set of Redis Streams — no cross-test contamination
 * even across repeated runs.
 */

import type { DomainEvent, IDomainEventBus } from "@jasonscharf/core";
import { InMemoryEventBus, RedisStreamEventBus } from "@jasonscharf/events";
import { Redis } from "ioredis";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ── Fixture IRIs ──────────────────────────────────────────────────────────────

const USER_CREATED = "http://tern.dev/ns/auth/user.created";
const USER_UPDATED = "http://tern.dev/ns/auth/user.updated";

interface UserPayload { userId: string; email: string; }

// ── Helpers ───────────────────────────────────────────────────────────────────

function uniqueId(): string {
    return Math.random().toString(36).slice(2, 10);
}

function makeEvent(type: string, payload: unknown, id = uniqueId()): DomainEvent<unknown> {
    return { id, type, source: "http://tern.dev/test", timestamp: Date.now(), payload };
}

function delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(condition: () => boolean, timeoutMs = 4000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
        if (Date.now() > deadline) {
            throw new Error(`waitFor timed out after ${timeoutMs}ms`);
        }
        await delay(20);
    }
}

async function cleanupRedisKeys(url: string, prefix: string): Promise<void> {
    const redis = new Redis(url);
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length > 0) {
        await redis.del(...keys);
    }
    await redis.quit();
}

// ── Shared IDomainEventBus contract suite ─────────────────────────────────────

function eventBusSuite(name: string, factory: () => IDomainEventBus) {
    describe(name, () => {
        let bus: IDomainEventBus;

        beforeEach(() => { bus = factory(); });
        afterEach(async () => { await bus.close(); });

        it("testSubscriberReceivesPublishedEvent", async () => {
            const received: DomainEvent<unknown>[] = [];
            await bus.subscribe(USER_CREATED, `sub-${uniqueId()}`, async (e) => { received.push(e); });

            const evt = makeEvent(USER_CREATED, { userId: "u1", email: "a@b.com" });
            await bus.publish(evt);

            await waitFor(() => received.length === 1);
            expect(received[0]?.id).toBe(evt.id);
            expect((received[0]?.payload as UserPayload).email).toBe("a@b.com");
        });

        it("testPublishWithNoSubscribersIsNoop", async () => {
            await expect(bus.publish(makeEvent(USER_CREATED, { userId: "u2" }))).resolves.not.toThrow();
        });

        it("testPublishDoesNotThrowWhenSubscriberHandlerThrows", async () => {
            // Bug 6: publish must isolate subscriber exceptions
            await bus.subscribe(USER_CREATED, `sub-${uniqueId()}`, async () => {
                throw new Error("subscriber failure");
            });
            await expect(bus.publish(makeEvent(USER_CREATED, {}))).resolves.not.toThrow();
        });

        it("testDifferentSubscriptionNamesBothReceiveEvent", async () => {
            const aIds: string[] = [];
            const bIds: string[] = [];
            const suffix = uniqueId();

            await bus.subscribe(USER_CREATED, `sub-a-${suffix}`, async (e) => {
                aIds.push((e.payload as UserPayload).userId);
            });
            await bus.subscribe(USER_CREATED, `sub-b-${suffix}`, async (e) => {
                bIds.push((e.payload as UserPayload).userId);
            });

            await bus.publish(makeEvent(USER_CREATED, { userId: "u3", email: "c@d.com" }));

            await waitFor(() => aIds.length === 1 && bIds.length === 1);
            expect(aIds).toEqual(["u3"]);
            expect(bIds).toEqual(["u3"]);
        });

        it("testSubscriberOnlyReceivesMatchingEventType", async () => {
            const received: DomainEvent<unknown>[] = [];
            await bus.subscribe(USER_CREATED, `sub-${uniqueId()}`, async (e) => { received.push(e); });

            await bus.publish(makeEvent(USER_UPDATED, { userId: "u4" }));
            await bus.publish(makeEvent(USER_CREATED, { userId: "u5", email: "e@f.com" }));

            await waitFor(() => received.length === 1);
            expect(received).toHaveLength(1);
            expect((received[0]?.payload as UserPayload).userId).toBe("u5");
        });

        it("testCancelPreventsSubsequentDelivery", async () => {
            const received: string[] = [];
            const sub = await bus.subscribe(USER_CREATED, `sub-${uniqueId()}`, async (e) => {
                received.push((e.payload as UserPayload).userId);
            });

            await bus.publish(makeEvent(USER_CREATED, { userId: "before", email: "a@b.com" }));
            await waitFor(() => received.length === 1);

            // cancel() must await loop exit so no more deliveries happen after it returns
            await sub.cancel();

            await bus.publish(makeEvent(USER_CREATED, { userId: "after", email: "c@d.com" }));
            await delay(100);  // generous window — loop must be fully stopped

            expect(received).toHaveLength(1);
            expect(received[0]).toBe("before");
        });

        it("testMultipleEventsDeliveredInOrder", async () => {
            const received: string[] = [];
            await bus.subscribe(USER_CREATED, `sub-${uniqueId()}`, async (e) => {
                received.push((e.payload as UserPayload).userId);
            });

            for (const id of ["u10", "u11", "u12"]) {
                await bus.publish(makeEvent(USER_CREATED, { userId: id, email: `${id}@x.com` }));
            }

            await waitFor(() => received.length === 3);
            expect(received).toEqual(["u10", "u11", "u12"]);
        });

        it("testSubscriptionExposesMetadata", async () => {
            const sub = await bus.subscribe(USER_CREATED, "meta-sub", async () => {});
            expect(sub.typeIri).toBe(USER_CREATED);
            expect(sub.subscriptionName).toBe("meta-sub");
            await sub.cancel();
        });
    });
}

// ── Run shared contract suite for InMemoryEventBus ────────────────────────────

eventBusSuite("InMemoryEventBus", () => new InMemoryEventBus());

// ── Run shared contract suite for RedisStreamEventBus ────────────────────────

if (process.env.TERN_REDIS_URL) {
    const redisUrl = process.env.TERN_REDIS_URL as string;

    // Each test gets its own stream prefix so re-runs never see stale messages.
    eventBusSuite("RedisStreamEventBus (contract)", () => {
        return new RedisStreamEventBus(redisUrl, {
            streamPrefix: `tern:test:${uniqueId()}:`,
            // Short claim settings so tests don't take forever
            claimMinIdleMs: 500,
            claimIntervalMs: 100,
        });
    });

    // ── Competing-consumer (consumer group) tests ─────────────────────────────

    describe("RedisStreamEventBus — competing consumers", () => {
        let prefix: string;
        let allBuses: RedisStreamEventBus[];

        function makeBus(): RedisStreamEventBus {
            const b = new RedisStreamEventBus(redisUrl, {
                streamPrefix: prefix,
                claimMinIdleMs: 300,
                claimIntervalMs: 80,
            });
            allBuses.push(b);
            return b;
        }

        beforeEach(() => {
            prefix = `tern:test:${uniqueId()}:`;
            allBuses = [];
        });

        afterEach(async () => {
            for (const b of allBuses) {
                await b.close();
            }
            await cleanupRedisKeys(redisUrl, prefix);
        });

        it("testCompetingConsumersEachMessageDeliveredOnce", async () => {
            // Two bus instances with the SAME subscriptionName form a competing
            // consumer group.  Each of the 10 published messages must be
            // processed by exactly one consumer — never both, never neither.
            const busA = makeBus();
            const busB = makeBus();

            const receivedA: string[] = [];
            const receivedB: string[] = [];
            const GROUP = "email-workers";

            await busA.subscribe(USER_CREATED, GROUP, async (e) => {
                receivedA.push((e.payload as UserPayload).userId);
            });
            await busB.subscribe(USER_CREATED, GROUP, async (e) => {
                receivedB.push((e.payload as UserPayload).userId);
            });

            const ids = Array.from({ length: 10 }, (_, i) => `u-${i}`);
            for (const id of ids) {
                await busA.publish(makeEvent(USER_CREATED, { userId: id, email: `${id}@x.com` }));
            }

            await waitFor(() => receivedA.length + receivedB.length === 10, 6000);

            const total = receivedA.length + receivedB.length;
            expect(total).toBe(10);

            // No message delivered twice
            const all = [...receivedA, ...receivedB];
            const unique = new Set(all);
            expect(unique.size).toBe(10);

            // Both consumers should have received at least one message
            // (probabilistic, but with 10 messages and BLOCK 1000ms it's reliable)
            expect(receivedA.length).toBeGreaterThan(0);
            expect(receivedB.length).toBeGreaterThan(0);
        });

        it("testDifferentGroupsEachReceiveAllMessages", async () => {
            // Two buses with DIFFERENT subscriptionNames are independent groups —
            // fan-out means both groups receive every message.
            const busA = makeBus();
            const busB = makeBus();

            const aIds: string[] = [];
            const bIds: string[] = [];

            await busA.subscribe(USER_CREATED, "group-analytics", async (e) => {
                aIds.push((e.payload as UserPayload).userId);
            });
            await busB.subscribe(USER_CREATED, "group-audit", async (e) => {
                bIds.push((e.payload as UserPayload).userId);
            });

            for (const id of ["x1", "x2", "x3"]) {
                await busA.publish(makeEvent(USER_CREATED, { userId: id, email: `${id}@x.com` }));
            }

            await waitFor(() => aIds.length === 3 && bIds.length === 3, 6000);
            expect(aIds.sort()).toEqual(["x1", "x2", "x3"]);
            expect(bIds.sort()).toEqual(["x1", "x2", "x3"]);
        });

        it("testConsumerIdsAreUnique", async () => {
            // Bug 3: Math.random() consumer IDs are not unique enough.
            // Two subscriptions must have distinct consumer IDs, otherwise Redis
            // treats them as the same consumer and only one gets messages.
            const busA = makeBus();
            const busB = makeBus();

            const subA = await busA.subscribe(USER_CREATED, "grp", async () => {});
            const subB = await busB.subscribe(USER_CREATED, "grp", async () => {});

            expect((subA as { consumerId?: string }).consumerId).not.toBe(
                (subB as { consumerId?: string }).consumerId,
            );
            await subA.cancel();
            await subB.cancel();
        });

        it("testCancelReturnsAfterLoopFullyExits", async () => {
            // Bug 4: cancel() must await the read loop so no handler calls
            // happen after it returns.
            const received: string[] = [];
            const bus = makeBus();
            const sub = await bus.subscribe(USER_CREATED, `grp-${uniqueId()}`, async (e) => {
                received.push((e.payload as UserPayload).userId);
            });

            await bus.publish(makeEvent(USER_CREATED, { userId: "before", email: "a@b.com" }));
            await waitFor(() => received.length === 1);

            await sub.cancel(); // Must block until read loop is done

            await bus.publish(makeEvent(USER_CREATED, { userId: "after", email: "c@d.com" }));
            await delay(200);

            expect(received).toHaveLength(1);
            expect(received[0]).toBe("before");
        });

        it("testHighVolumeMessagesAllDeliveredOnce", async () => {
            // 3 competing consumers, 30 messages — every message delivered exactly once.
            const buses = [makeBus(), makeBus(), makeBus()];
            const GROUP = `pool-${uniqueId()}`;
            const received: string[] = [];

            for (const b of buses) {
                await b.subscribe(USER_CREATED, GROUP, async (e) => {
                    received.push((e.payload as UserPayload).userId);
                });
            }

            const ids = Array.from({ length: 30 }, (_, i) => `msg-${i}`);
            for (const id of ids) {
                await buses[0]?.publish(makeEvent(USER_CREATED, { userId: id, email: `${id}@x.com` }));
            }

            await waitFor(() => received.length === 30, 10000);

            expect(received).toHaveLength(30);
            expect(new Set(received).size).toBe(30);
        });
    });

    // ── At-least-once delivery (XAUTOCLAIM) tests ─────────────────────────────

    describe("RedisStreamEventBus — at-least-once delivery via XAUTOCLAIM", () => {
        let prefix: string;
        let allBuses: RedisStreamEventBus[];

        function makeBus(claimMinIdleMs = 200): RedisStreamEventBus {
            const b = new RedisStreamEventBus(redisUrl, {
                streamPrefix: prefix,
                claimMinIdleMs,
                claimIntervalMs: 60,  // Run claim checks frequently in tests
            });
            allBuses.push(b);
            return b;
        }

        beforeEach(() => {
            prefix = `tern:test:${uniqueId()}:`;
            allBuses = [];
        });

        afterEach(async () => {
            for (const b of allBuses) {
                await b.close();
            }
            await cleanupRedisKeys(redisUrl, prefix);
        });

        it("testSuccessfulHandlerAcksMessageNoRedelivery", async () => {
            // A message processed by a succeeding handler must not be
            // redelivered by XAUTOCLAIM (it should be ACKed and gone).
            const bus = makeBus();
            const received: string[] = [];

            await bus.subscribe(USER_CREATED, `grp-${uniqueId()}`, async (e) => {
                received.push((e.payload as UserPayload).userId);
            });

            await bus.publish(makeEvent(USER_CREATED, { userId: "acked", email: "a@b.com" }));
            await waitFor(() => received.length === 1);

            // Wait well past claimMinIdleMs to give XAUTOCLAIM time to run
            await delay(600);

            expect(received).toHaveLength(1);
            expect(received[0]).toBe("acked");
        });

        it("testCrashedConsumerMessageReclaimedBySurvivor", async () => {
            // Real-world mission-critical scenario: consumer A receives a message,
            // its handler fails, and then A crashes (ungraceful close) before
            // retrying.  Consumer B in the same pool must reclaim the orphaned PEL
            // entry via XAUTOCLAIM and deliver successfully.
            //
            // Note: XAUTOCLAIM is for reclaiming from DEAD/crashed consumers.
            // Two live consumers both calling XAUTOCLAIM race to re-claim —
            // the test is designed so A is fully gone before B joins, making
            // the reclaim deterministic.
            const GROUP = `grp-${uniqueId()}`;

            // busA subscribes ALONE — guaranteed to receive the first message.
            const busA = makeBus(300);
            await busA.subscribe(USER_CREATED, GROUP, async () => {
                throw new Error("crash");  // always fails
            });

            await busA.publish(makeEvent(USER_CREATED, { userId: "orphaned", email: "o@o.com" }));

            // Give busA's read loop time to receive and fail on the message.
            // After the BLOCK expires (~1000ms), busA's handler throws and the
            // message is left un-ACKed in busA's PEL.
            await delay(1300);

            // busA "crashes" — close without processing the pending message.
            await busA.close();

            // busB joins the same group.  The message is still in the PEL owned
            // by busA's (now-dead) consumer.  After claimMinIdleMs (300ms), busB's
            // XAUTOCLAIM pass should reclaim and successfully process it.
            const busB = makeBus(300);
            const rescuedByB: string[] = [];
            await busB.subscribe(USER_CREATED, GROUP, async (e) => {
                rescuedByB.push((e.payload as UserPayload).userId);
            });

            await waitFor(() => rescuedByB.length === 1, 5000);
            expect(rescuedByB).toContain("orphaned");
        });

        it("testFailingHandlerOnSingleConsumerEventuallyReclaimedBySelf", async () => {
            // When there is only one consumer and its handler fails, XAUTOCLAIM
            // should redeliver the message to that same consumer on the next cycle.
            let callCount = 0;
            const received: string[] = [];
            const GROUP = `grp-${uniqueId()}`;
            const bus = makeBus(200);

            await bus.subscribe(USER_CREATED, GROUP, async (e) => {
                callCount++;
                if (callCount < 3) {
                    throw new Error(`failing attempt ${callCount}`);
                }
                // Succeed on 3rd try
                received.push((e.payload as UserPayload).userId);
            });

            await bus.publish(makeEvent(USER_CREATED, { userId: "retry-me", email: "r@r.com" }));

            await waitFor(() => received.length === 1, 6000);
            expect(received).toContain("retry-me");
            expect(callCount).toBeGreaterThanOrEqual(3);
        });
    });

} else {
    describe("RedisStreamEventBus (skipped — set TERN_REDIS_URL to enable)", () => {
        it("testSkipped", () => { /* no-op */ });
    });
}
