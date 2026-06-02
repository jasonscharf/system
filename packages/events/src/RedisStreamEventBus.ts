import { randomUUID } from "node:crypto";
import type { DomainEvent, EventSubscription, IDomainEventBus } from "@jasonscharf/core";
import { Redis } from "ioredis";

// ── Options ───────────────────────────────────────────────────────────────────

export interface RedisStreamEventBusOptions {
    /**
     * Key prefix applied to every Redis stream.
     * Override per-instance in tests to prevent cross-test contamination.
     * Default: "tern:events:"
     */
    streamPrefix?: string;
    /**
     * A pending message must be idle at least this many milliseconds before
     * XAUTOCLAIM will reassign it to another consumer.
     * Default: 30 000 (30 s) — set lower in tests.
     */
    claimMinIdleMs?: number;
    /**
     * How often (ms) to run an XAUTOCLAIM pass within the read loop.
     * Default: 5 000 (5 s).
     */
    claimIntervalMs?: number;
    /**
     * Maximum messages to claim per XAUTOCLAIM pass.
     * Default: 10.
     */
    claimBatchSize?: number;
}

// ── Internal types ────────────────────────────────────────────────────────────

type AnyHandler = (event: DomainEvent<unknown>) => Promise<void>;

interface ActiveSub {
    readonly typeIri: string;
    readonly subscriptionName: string;
    readonly consumerId: string;
    running: boolean;
    readonly redis: Redis;
    /** Resolved when the read loop exits — awaited by cancel()/close(). */
    readonly loopDone: Promise<void>;
    /** When (Date.now()) the next XAUTOCLAIM pass should run. */
    nextClaimAt: number;
}

// ── RedisStreamEventBus ───────────────────────────────────────────────────────

/**
 * Distributed event bus backed by Redis Streams and consumer groups.
 *
 * Delivery semantics
 * ──────────────────
 * • Competing consumers (same subscriptionName): each message is delivered
 *   to exactly one consumer in the group — load-balanced across all instances
 *   that share the name.
 * • Fan-out (different subscriptionNames): every group independently receives
 *   every message published to a topic.
 * • At-least-once: if a handler throws, the message stays in the Pending
 *   Entry List.  XAUTOCLAIM periodically reassigns idle PEL entries to an
 *   available consumer so no message is silently dropped.
 *
 * Robustness
 * ──────────
 * • Consumer IDs are UUIDs — guaranteed unique across instances.
 * • Transient Redis errors (network blip, timeout) restart the read loop
 *   with a short back-off rather than killing the consumer permanently.
 * • cancel() / close() await the read loop's exit before returning so
 *   callers can be certain no more handler invocations will occur.
 */
export class RedisStreamEventBus implements IDomainEventBus {
    private readonly _url: string;
    private readonly _prefix: string;
    private readonly _claimMinIdleMs: number;
    private readonly _claimIntervalMs: number;
    private readonly _claimBatchSize: number;
    private readonly _publishRedis: Redis;
    private readonly _activeSubs: ActiveSub[] = [];

    constructor(redisUrl: string, options: RedisStreamEventBusOptions = {}) {
        this._url = redisUrl;
        this._prefix = options.streamPrefix ?? "tern:events:";
        this._claimMinIdleMs = options.claimMinIdleMs ?? 30_000;
        this._claimIntervalMs = options.claimIntervalMs ?? 5_000;
        this._claimBatchSize = options.claimBatchSize ?? 10;
        this._publishRedis = new Redis(redisUrl);
    }

    async publish<T>(event: DomainEvent<T>): Promise<void> {
        const key = this._key(event.type);
        await this._publishRedis.xadd(
            key, "*",
            "id", event.id,
            "type", event.type,
            "source", event.source,
            "timestamp", String(event.timestamp),
            "payload", JSON.stringify(event.payload),
        );
    }

    async subscribe<T>(
        typeIri: string,
        subscriptionName: string,
        handler: (event: DomainEvent<T>) => Promise<void>,
    ): Promise<EventSubscription> {
        const key = this._key(typeIri);
        const consumerId = randomUUID();
        const reader = new Redis(this._url);

        // MKSTREAM creates the stream if it doesn't exist yet.
        // BUSYGROUP means the group already exists — that's fine.
        try {
            await reader.xgroup("CREATE", key, subscriptionName, "$", "MKSTREAM");
        } catch (err: unknown) {
            if (!(err instanceof Error) || !err.message.includes("BUSYGROUP")) {
                throw err;
            }
        }

        let resolveLoopDone!: () => void;
        const loopDone = new Promise<void>((res) => { resolveLoopDone = res; });

        const sub: ActiveSub = {
            typeIri,
            subscriptionName,
            consumerId,
            running: true,
            redis: reader,
            loopDone,
            nextClaimAt: Date.now() + this._claimIntervalMs,
        };
        this._activeSubs.push(sub);

        const wrappedHandler = handler as AnyHandler;
        this._readLoop(sub, key, wrappedHandler).finally(resolveLoopDone);

        return {
            typeIri,
            subscriptionName,
            // Expose consumerId so tests can assert uniqueness
            ...{ consumerId },
            cancel: async () => {
                sub.running = false;
                await reader.quit();
                await loopDone;
                const idx = this._activeSubs.indexOf(sub);
                if (idx !== -1) {
                    this._activeSubs.splice(idx, 1);
                }
            },
        };
    }

    async close(): Promise<void> {
        const subs = [...this._activeSubs];
        for (const sub of subs) {
            sub.running = false;
            await sub.redis.quit();
        }
        await Promise.all(subs.map((s) => s.loopDone));
        this._activeSubs.length = 0;
        await this._publishRedis.quit();
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private _key(typeIri: string): string {
        return `${this._prefix}${Buffer.from(typeIri).toString("base64url")}`;
    }

    private async _readLoop(sub: ActiveSub, key: string, handler: AnyHandler): Promise<void> {
        while (sub.running) {
            // ── Deliver new messages ──────────────────────────────────────────
            let results: [string, [string, string[]][]][] | null = null;
            try {
                results = (await sub.redis.xreadgroup(
                    "GROUP", sub.subscriptionName, sub.consumerId,
                    "COUNT", "10",
                    "BLOCK", "1000",
                    "STREAMS", key, ">",
                )) as [string, [string, string[]][]][] | null;
            } catch {
                if (!sub.running) {
                    break; // Expected: quit() called during shutdown
                }
                // Unexpected error (network blip, etc.) — back off and retry
                // so the consumer doesn't die permanently on a transient fault.
                await _delay(500);
                continue;
            }

            if (results) {
                await this._processMessages(sub, key, results, handler);
            }

            // ── XAUTOCLAIM: reclaim idle pending messages ─────────────────────
            if (sub.running && Date.now() >= sub.nextClaimAt) {
                await this._runClaim(sub, key, handler);
                sub.nextClaimAt = Date.now() + this._claimIntervalMs;
            }
        }
    }

    private async _processMessages(
        sub: ActiveSub,
        key: string,
        results: [string, [string, string[]][]][],
        handler: AnyHandler,
    ): Promise<void> {
        for (const [, messages] of results) {
            for (const [msgId, fields] of messages) {
                const event = _parseFields(fields);
                if (!event) {
                    continue;
                }
                try {
                    await handler(event);
                    await sub.redis.xack(key, sub.subscriptionName, msgId);
                } catch {
                    // Leave un-ACKed so XAUTOCLAIM can reassign it to another
                    // consumer after claimMinIdleMs.
                }
            }
        }
    }

    private async _runClaim(sub: ActiveSub, key: string, handler: AnyHandler): Promise<void> {
        let cursor = "0-0";
        do {
            let raw: unknown;
            try {
                // XAUTOCLAIM key group consumer min-idle-time start COUNT n
                // Returns: [nextCursor, [[msgId, fields[]], ...], [deletedIds[]]]
                raw = await sub.redis.xautoclaim(
                    key,
                    sub.subscriptionName,
                    sub.consumerId,
                    this._claimMinIdleMs,
                    cursor,
                    "COUNT", String(this._claimBatchSize),
                );
            } catch {
                return; // Connection likely closing — abort this pass
            }

            if (!Array.isArray(raw) || raw.length < 2) {
                break;
            }

            const [nextCursor, messages] = raw as [string, [string, string[]][]];

            for (const [msgId, fields] of messages) {
                if (!Array.isArray(fields)) {
                    continue;
                }
                const event = _parseFields(fields);
                if (!event) {
                    continue;
                }
                try {
                    await handler(event);
                    await sub.redis.xack(key, sub.subscriptionName, msgId);
                } catch {
                    // Still failing — will be retried on the next claim cycle.
                }
            }

            cursor = nextCursor ?? "0-0";
        } while (cursor !== "0-0" && cursor !== "0" && sub.running);
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _parseFields(fields: string[]): DomainEvent<unknown> | null {
    const map: Record<string, string> = {};
    for (let i = 0; i + 1 < fields.length; i += 2) {
        const k = fields[i];
        const v = fields[i + 1];
        if (k !== undefined && v !== undefined) {
            map[k] = v;
        }
    }
    if (!map.id || !map.type || !map.source || !map.timestamp || !map.payload) {
        return null;
    }
    return {
        id: map.id,
        type: map.type,
        source: map.source,
        timestamp: Number(map.timestamp),
        payload: JSON.parse(map.payload) as unknown,
    };
}

function _delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}
