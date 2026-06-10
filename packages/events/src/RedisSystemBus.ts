import { randomUUID } from "node:crypto";
import {
    type DomainEvent,
    type EventSubscription,
    type ISystemBus,
    NS_CORE,
    type RpcHandler,
    type RpcKind,
    makeUri,
} from "@jasonscharf/core";
import { Redis } from "ioredis";
import { RedisStreamEventBus, type RedisStreamEventBusOptions } from "./RedisStreamEventBus.js";

// ── Options ───────────────────────────────────────────────────────────────────

export interface RedisSystemBusOptions extends RedisStreamEventBusOptions {
    /**
     * Prefix for RPC request streams and reply lists.
     * Default: "urn:sys:core:rpc:"
     */
    rpcPrefix?: string;
    /**
     * How long (ms) the caller blocks waiting for an RPC reply before timing out.
     * Default: 10 000 (10 s)
     */
    rpcTimeoutMs?: number;
    /**
     * TTL (seconds) set on reply keys after a result is pushed.
     * Prevents orphaned keys when the caller crashes before popping.
     * Default: 60
     */
    replyTtlSecs?: number;
    /**
     * Consumer group name used by all handle() listeners on this bus.
     * Instances sharing the same group compete for each request (load-balanced).
     * Default: "handlers"
     */
    handlerGroup?: string;
}

// ── Wire types ────────────────────────────────────────────────────────────────

interface RpcRequest {
    id: string;
    kind: RpcKind;
    typeIri: string;
    payload: string;   // JSON
    replyTo: string;   // Redis list key for BRPOP
}

interface RpcReply {
    ok: boolean;
    data?: unknown;
    error?: string;
}

// ── RedisSystemBus ────────────────────────────────────────────────────────────

/**
 * Distributed messaging bus backed by Redis.
 *
 * Events:  Redis Streams + consumer groups (inherited from RedisStreamEventBus).
 *          Pub/sub with fan-out across different subscriptionNames.
 *
 * RPC (command/query/operation):
 *   • Caller      XADD  {rpcPrefix}{kind}:{b64(typeIri)}  request fields
 *   • Caller      BRPOP {replyKey} {timeout}
 *   • Handler     XREADGROUP … process → LPUSH {replyKey} {json}
 *                 → EXPIRE {replyKey} {ttl}
 *                 → XACK
 *
 * Competing consumers: all instances that call handle() for the same
 * (typeIri, kind) join the same consumer group.  Each request is processed
 * by exactly one handler.
 */
export class RedisSystemBus implements ISystemBus {
    private readonly _eventBus: RedisStreamEventBus;
    private readonly _publishRedis: Redis;
    private readonly _rpcPrefix: string;
    private readonly _rpcTimeoutMs: number;
    private readonly _replyTtlSecs: number;
    private readonly _handlerGroup: string;
    private readonly _url: string;
    private readonly _handlerSubs: Array<{ cancel: () => Promise<void> }> = [];
    private _closed = false;

    constructor(redisUrl: string, options: RedisSystemBusOptions = {}) {
        this._url = redisUrl;
        this._rpcPrefix = options.rpcPrefix ?? `${makeUri(NS_CORE, "rpc")}:`;
        this._rpcTimeoutMs = options.rpcTimeoutMs ?? 10_000;
        this._replyTtlSecs = options.replyTtlSecs ?? 60;
        this._handlerGroup = options.handlerGroup ?? "handlers";
        this._eventBus = new RedisStreamEventBus(redisUrl, options);
        this._publishRedis = new Redis(redisUrl);
    }

    // ── Events (delegated to RedisStreamEventBus) ─────────────────────────────

    async publish<T>(event: DomainEvent<T>): Promise<void> {
        return this._eventBus.publish(event);
    }

    async subscribe<T>(
        typeIri: string,
        subscriptionName: string,
        handler: (event: DomainEvent<T>) => Promise<void>,
    ): Promise<EventSubscription> {
        return this._eventBus.subscribe(typeIri, subscriptionName, handler);
    }

    // ── RPC — callers ─────────────────────────────────────────────────────────

    async command(typeIri: string, payload?: unknown): Promise<void> {
        await this._rpc("command", typeIri, payload);
    }

    async query<T = unknown>(typeIri: string, payload?: unknown): Promise<T> {
        return this._rpc("query", typeIri, payload) as Promise<T>;
    }

    async operation<T = unknown>(typeIri: string, payload?: unknown): Promise<T> {
        return this._rpc("operation", typeIri, payload) as Promise<T>;
    }

    private async _rpc(kind: RpcKind, typeIri: string, payload: unknown): Promise<unknown> {
        const id = randomUUID();
        const replyKey = `${this._rpcPrefix}reply:${id}`;
        const streamKey = this._rpcStreamKey(kind, typeIri);

        await this._publishRedis.xadd(
            streamKey, "*",
            "id", id,
            "kind", kind,
            "typeIri", typeIri,
            "payload", JSON.stringify(payload ?? null),
            "replyTo", replyKey,
        );

        const timeoutSecs = Math.ceil(this._rpcTimeoutMs / 1000);
        const result = await this._publishRedis.brpop(replyKey, timeoutSecs);

        if (!result) {
            throw new Error(`RPC timeout (${this._rpcTimeoutMs}ms): ${kind} ${typeIri}`);
        }

        const reply = JSON.parse(result[1]) as RpcReply;
        if (!reply.ok) {
            throw new Error(reply.error ?? `RPC error: ${kind} ${typeIri}`);
        }
        return reply.data;
    }

    // ── RPC — handlers ────────────────────────────────────────────────────────

    handle(typeIri: string, kind: RpcKind, fn: RpcHandler): Promise<void> {
        const streamKey = this._rpcStreamKey(kind, typeIri);
        const group = this._handlerGroup;
        const consumerId = randomUUID();
        const url = this._url;
        const replyTtlSecs = this._replyTtlSecs;

        const reader = new Redis(url);
        let running = true;

        let resolveLoopDone!: () => void;
        const loopDone = new Promise<void>((res) => { resolveLoopDone = res; });

        // Ensure consumer group exists (MKSTREAM creates stream if needed).
        // Using "0-0" so messages added immediately after handle() returns are
        // not missed if they were briefly on the stream before the group
        // creation completed.  For fresh per-test streams this is a no-op.
        const ready = reader
            .xgroup("CREATE", streamKey, group, "0-0", "MKSTREAM")
            .catch((err: unknown) => {
                if (err instanceof Error && err.message.includes("BUSYGROUP")) {
                    return;
                }
                throw err;
            });

        const loop = async (): Promise<void> => {
            await ready;
            while (running) {
                let results: [string, [string, string[]][]][] | null = null;
                try {
                    results = (await reader.xreadgroup(
                        "GROUP", group, consumerId,
                        "COUNT", "1",
                        "BLOCK", "1000",
                        "STREAMS", streamKey, ">",
                    )) as [string, [string, string[]][]][] | null;
                } catch {
                    if (!running) {
                        break;
                    }
                    await _delay(200);
                    continue;
                }

                if (!results) {
                    continue;
                }

                for (const [, messages] of results) {
                    for (const [msgId, fields] of messages) {
                        const req = _parseRpcRequest(fields);
                        if (!req) {
                            await reader.xack(streamKey, group, msgId).catch(() => {});
                            continue;
                        }

                        let reply: RpcReply;
                        try {
                            const data = await fn(JSON.parse(req.payload) as unknown);
                            reply = { ok: true, data };
                        } catch (err: unknown) {
                            reply = {
                                ok: false,
                                error: err instanceof Error ? err.message : String(err),
                            };
                        }

                        const replyRedis = new Redis(url);
                        try {
                            await replyRedis.lpush(req.replyTo, JSON.stringify(reply));
                            await replyRedis.expire(req.replyTo, replyTtlSecs);
                        } finally {
                            await replyRedis.quit().catch(() => {});
                        }

                        await reader.xack(streamKey, group, msgId).catch(() => {});
                    }
                }
            }
        };

        loop().finally(resolveLoopDone);

        this._handlerSubs.push({
            cancel: async () => {
                running = false;
                await reader.quit().catch(() => {});
                await loopDone;
            },
        });

        // Resolve after XGROUP CREATE so callers that await handle() are
        // guaranteed the consumer group exists before they send any requests.
        return ready.then(() => {});
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    async close(): Promise<void> {
        if (this._closed) {
            return;
        }
        this._closed = true;
        for (const sub of this._handlerSubs) {
            await sub.cancel();
        }
        this._handlerSubs.length = 0;
        await this._eventBus.close();
        await this._publishRedis.quit().catch(() => {});
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private _rpcStreamKey(kind: RpcKind, typeIri: string): string {
        return `${this._rpcPrefix}${kind}:${Buffer.from(typeIri).toString("base64url")}`;
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _parseRpcRequest(fields: string[]): RpcRequest | null {
    const map: Record<string, string> = {};
    for (let i = 0; i + 1 < fields.length; i += 2) {
        const k = fields[i];
        const v = fields[i + 1];
        if (k !== undefined && v !== undefined) {
            map[k] = v;
        }
    }
    if (!map.id || !map.kind || !map.typeIri || !map.payload || !map.replyTo) {
        return null;
    }
    return {
        id: map.id,
        kind: map.kind as RpcKind,
        typeIri: map.typeIri,
        payload: map.payload,
        replyTo: map.replyTo,
    };
}

function _delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}
