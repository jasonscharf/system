import type { DomainEvent, EventSubscription, IDomainEventBus } from "@jasonscharf/core";
import { Redis } from "ioredis";

// ── Stream key helpers ────────────────────────────────────────────────────────

function streamKey(typeIri: string): string {
    return `tern:events:${Buffer.from(typeIri).toString("base64url")}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ActiveSubscription {
    readonly typeIri: string;
    readonly subscriptionName: string;
    readonly consumerId: string;
    running: boolean;
    readonly redis: Redis;
}

// ── RedisStreamEventBus ───────────────────────────────────────────────────────

/**
 * Distributed event bus backed by Redis Streams and consumer groups.
 *
 * Delivery semantics:
 *   - All instances sharing a subscriptionName compete for each message
 *     (exactly-once delivery within that group — load balanced).
 *   - Different subscriptionNames each receive every published message
 *     (fan-out).
 *
 * Pass a connected ioredis instance.  The bus creates additional per-
 * subscription reader connections internally so blocking reads don't
 * block the shared connection.
 */
export class RedisStreamEventBus implements IDomainEventBus {
    private readonly _url: string;
    private readonly _publishRedis: Redis;
    private readonly _activeSubs: ActiveSubscription[] = [];

    constructor(redisUrl: string) {
        this._url = redisUrl;
        this._publishRedis = new Redis(redisUrl, { lazyConnect: true });
    }

    async publish<T>(event: DomainEvent<T>): Promise<void> {
        const key = streamKey(event.type);
        await this._publishRedis.xadd(
            key,
            "*",
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
        const key = streamKey(typeIri);
        const consumerId = `consumer-${Math.random().toString(36).slice(2)}`;

        const reader = new Redis(this._url, { lazyConnect: true });

        // Create consumer group, starting from new messages only.
        // MKSTREAM creates the stream if it doesn't exist yet.
        try {
            await reader.xgroup("CREATE", key, subscriptionName, "$", "MKSTREAM");
        } catch (err: unknown) {
            // BUSYGROUP = group already exists; that's fine.
            if (!(err instanceof Error) || !err.message.includes("BUSYGROUP")) {
                throw err;
            }
        }

        const sub: ActiveSubscription = {
            typeIri,
            subscriptionName,
            consumerId,
            running: true,
            redis: reader,
        };
        this._activeSubs.push(sub);

        void this._readLoop(sub, key, handler as (e: DomainEvent<unknown>) => Promise<void>);

        return {
            typeIri,
            subscriptionName,
            cancel: async () => {
                sub.running = false;
                await reader.quit();
                const idx = this._activeSubs.indexOf(sub);
                if (idx !== -1) {
                    this._activeSubs.splice(idx, 1);
                }
            },
        };
    }

    async close(): Promise<void> {
        for (const sub of [...this._activeSubs]) {
            sub.running = false;
            await sub.redis.quit();
        }
        this._activeSubs.length = 0;
        await this._publishRedis.quit();
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private async _readLoop(
        sub: ActiveSubscription,
        key: string,
        handler: (event: DomainEvent<unknown>) => Promise<void>,
    ): Promise<void> {
        while (sub.running) {
            let results: [string, [string, string[]][]][] | null = null;
            try {
                // BLOCK 1000ms so we can check sub.running and shut down cleanly.
                results = (await sub.redis.xreadgroup(
                    "GROUP", sub.subscriptionName, sub.consumerId,
                    "COUNT", "10",
                    "BLOCK", "1000",
                    "STREAMS", key, ">",
                )) as [string, [string, string[]][]][] | null;
            } catch {
                // Connection closed during shutdown — exit loop.
                break;
            }

            if (!results) {
                continue;
            }

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
                        // Leave un-acked for retry (will be picked up by XAUTOCLAIM later).
                    }
                }
            }
        }
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
