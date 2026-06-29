/**
 * RedisSystemBus - a Redis-backed ISystemBus for in-process use.
 *
 * Runs inside the application process (no separate broker) and uses a Redis
 * connection as the transport, giving at-least-once, cross-process delivery:
 *
 *   Events     - Redis streams + consumer groups. publish() XADDs to a per-type
 *                stream; subscribe(typeIri, subscriptionName) joins a consumer
 *                group named after the subscription. Instances sharing a
 *                subscription name compete for each message (load balanced);
 *                distinct subscription names each receive every message
 *                (fan-out) - exactly the IDomainEventBus contract.
 *
 *   RPC        - command/query/operation. The caller XADDs a request to a
 *                per-(kind,type) stream and awaits a reply on its own pub/sub
 *                inbox; handle() consumes the request stream via a shared
 *                "handlers" group and publishes the reply to the caller's inbox.
 *                Request delivery is at-least-once; the reply is best-effort
 *                (the caller times out and may retry), which is the standard
 *                RPC-over-bus tradeoff.
 *
 * Blocking reads (XREADGROUP / subscribe) each run on their own duplicated
 * connection so they never tie up the shared command connection.
 */

import { randomUUID } from "node:crypto";
import type {
    DomainEvent,
    EventSubscription,
    ISystemBus,
    RpcHandler,
    RpcKind,
} from "@jasonscharf/core";
import type { Redis } from "ioredis";

export interface RedisSystemBusOptions {
    /** Namespace for all bus keys. Default: "bus". */
    keyPrefix?: string;
    /** XREADGROUP / subscribe block interval in ms. Default: 1000. */
    blockMs?: number;
    /** Approximate cap on each stream's length (MAXLEN ~). Default: 100000. */
    maxLen?: number;
    /** Default RPC reply timeout in ms. Default: 10000. */
    requestTimeoutMs?: number;
}

interface PendingRpc {
    resolve: (value: unknown) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

interface RpcReply {
    id: string;
    ok: boolean;
    result?: unknown;
    error?: string;
}

interface ConsumeLoop {
    running: boolean;
    conn: Redis;
}

const HANDLER_GROUP = "handlers";

export class RedisSystemBus implements ISystemBus {
    private readonly _cmd: Redis;
    private readonly _prefix: string;
    private readonly _blockMs: number;
    private readonly _maxLen: number;
    private readonly _requestTimeoutMs: number;
    private readonly _instanceId = randomUUID();

    private readonly _loops = new Set<ConsumeLoop>();
    private readonly _pending = new Map<string, PendingRpc>();
    /** Active RPC handler loop per "<kind>:<typeIri>" so a second handle() replaces the first. */
    private readonly _handlers = new Map<string, ConsumeLoop>();

    private _replySub: Redis | null = null;
    private _replyReady: Promise<void> | null = null;
    private _closed = false;

    constructor(redis: Redis, options: RedisSystemBusOptions = {}) {
        this._cmd = redis;
        this._prefix = options.keyPrefix ?? "bus";
        this._blockMs = options.blockMs ?? 1_000;
        this._maxLen = options.maxLen ?? 100_000;
        this._requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    }

    // ── Key helpers ─────────────────────────────────────────────────────────────

    private _eventStream(typeIri: string): string {
        return `${this._prefix}:event:${typeIri}`;
    }

    private _rpcStream(kind: RpcKind, typeIri: string): string {
        return `${this._prefix}:rpc:${kind}:${typeIri}`;
    }

    private get _replyChannel(): string {
        return `${this._prefix}:reply:${this._instanceId}`;
    }

    // ── Events (IDomainEventBus) ─────────────────────────────────────────────────

    async publish<T>(event: DomainEvent<T>): Promise<void> {
        await this._xadd(this._eventStream(event.type), "data", JSON.stringify(event));
    }

    async subscribe<T>(
        typeIri: string,
        subscriptionName: string,
        handler: (event: DomainEvent<T>) => Promise<void>,
    ): Promise<EventSubscription> {
        const stream = this._eventStream(typeIri);
        await this._ensureGroup(stream, subscriptionName);

        const loop = this._startConsumeLoop(stream, subscriptionName, async (fields) => {
            const raw = fields.data;
            if (raw === undefined) {
                return;
            }
            const event = JSON.parse(raw) as DomainEvent<T>;
            await handler(event);
        });

        return {
            typeIri,
            subscriptionName,
            cancel: async () => {
                await this._stopLoop(loop);
            },
        };
    }

    // ── RPC (ISystemBus) ─────────────────────────────────────────────────────────

    async command(typeIri: string, payload?: unknown): Promise<void> {
        await this._request("command", typeIri, payload);
    }

    query<T = unknown>(typeIri: string, payload?: unknown): Promise<T> {
        return this._request("query", typeIri, payload) as Promise<T>;
    }

    operation<T = unknown>(typeIri: string, payload?: unknown): Promise<T> {
        return this._request("operation", typeIri, payload) as Promise<T>;
    }

    async handle(typeIri: string, kind: RpcKind, fn: RpcHandler): Promise<void> {
        const key = `${kind}:${typeIri}`;
        const existing = this._handlers.get(key);
        if (existing) {
            await this._stopLoop(existing);
            this._handlers.delete(key);
        }

        const stream = this._rpcStream(kind, typeIri);
        await this._ensureGroup(stream, HANDLER_GROUP);

        const loop = this._startConsumeLoop(stream, HANDLER_GROUP, async (fields) => {
            const id = fields.id;
            const replyChannel = fields.replyChannel;
            if (id === undefined || replyChannel === undefined) {
                return;
            }
            const reply: RpcReply = { id, ok: true };
            try {
                const payload =
                    fields.payload === undefined ? undefined : JSON.parse(fields.payload);
                reply.result = await fn(payload);
            } catch (err: unknown) {
                reply.ok = false;
                reply.error = (err as Error).message;
            }
            await this._cmd.publish(replyChannel, JSON.stringify(reply));
        });

        this._handlers.set(key, loop);
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────────

    async close(): Promise<void> {
        this._closed = true;
        for (const [, p] of this._pending) {
            clearTimeout(p.timer);
            p.reject(new Error("RedisSystemBus closed"));
        }
        this._pending.clear();

        const loops = [...this._loops];
        await Promise.all(loops.map((l) => this._stopLoop(l)));
        this._handlers.clear();

        if (this._replySub) {
            await this._replySub.quit().catch(() => this._replySub?.disconnect());
            this._replySub = null;
        }
    }

    // ── RPC request/reply plumbing ─────────────────────────────────────────────────

    private async _request(kind: RpcKind, typeIri: string, payload?: unknown): Promise<unknown> {
        if (this._closed) {
            throw new Error("RedisSystemBus is closed");
        }
        await this._ensureReplySub();

        const id = randomUUID();
        const result = new Promise<unknown>((resolve, reject) => {
            const timer = setTimeout(() => {
                this._pending.delete(id);
                reject(
                    new Error(`RPC ${kind} ${typeIri} timed out after ${this._requestTimeoutMs}ms`),
                );
            }, this._requestTimeoutMs);
            this._pending.set(id, { resolve, reject, timer });
        });

        await this._xadd(
            this._rpcStream(kind, typeIri),
            "id",
            id,
            "replyChannel",
            this._replyChannel,
            "payload",
            JSON.stringify(payload ?? null),
        );

        return result;
    }

    /** Subscribe (once) to this instance's reply inbox. */
    private _ensureReplySub(): Promise<void> {
        if (this._replyReady) {
            return this._replyReady;
        }
        this._replyReady = (async () => {
            const sub = this._cmd.duplicate();
            sub.on("message", (_channel: string, message: string) => {
                let reply: RpcReply;
                try {
                    reply = JSON.parse(message) as RpcReply;
                } catch {
                    return;
                }
                const pending = this._pending.get(reply.id);
                if (!pending) {
                    return;
                }
                clearTimeout(pending.timer);
                this._pending.delete(reply.id);
                if (reply.ok) {
                    pending.resolve(reply.result);
                } else {
                    pending.reject(new Error(reply.error ?? "RPC handler error"));
                }
            });
            await sub.subscribe(this._replyChannel);
            this._replySub = sub;
        })();
        return this._replyReady;
    }

    // ── Stream consumption ──────────────────────────────────────────────────────

    /** Start a background XREADGROUP loop on its own connection. */
    private _startConsumeLoop(
        stream: string,
        group: string,
        onEntry: (fields: Record<string, string>) => Promise<void>,
    ): ConsumeLoop {
        const loop: ConsumeLoop = { running: true, conn: this._cmd.duplicate() };
        this._loops.add(loop);
        // Background loop: it owns its own error handling per-iteration and only
        // exits when loop.running flips false. A rejection here would mean the loop
        // crashed unexpectedly, so it must be LOGGED rather than become an
        // unhandled rejection.
        this._consume(loop, stream, group, onEntry).catch((err: unknown) => {
            console.error(
                `[RedisSystemBus] consume loop crashed on ${stream}: ${(err as Error).message}`,
            );
        });
        return loop;
    }

    private async _consume(
        loop: ConsumeLoop,
        stream: string,
        group: string,
        onEntry: (fields: Record<string, string>) => Promise<void>,
    ): Promise<void> {
        while (loop.running) {
            let results: Array<[string, Array<[string, string[]]>]> | null;
            try {
                // biome-ignore lint/suspicious/noExplicitAny: ioredis stream commands lack public overloads
                results = (await (loop.conn as any).xreadgroup(
                    "GROUP",
                    group,
                    this._instanceId,
                    "COUNT",
                    10,
                    "BLOCK",
                    this._blockMs,
                    "STREAMS",
                    stream,
                    ">",
                )) as Array<[string, Array<[string, string[]]>]> | null;
            } catch (err: unknown) {
                if (!loop.running) {
                    break;
                }
                console.error(
                    `[RedisSystemBus] XREADGROUP error on ${stream}: ${(err as Error).message}`,
                );
                continue;
            }

            for (const [, entries] of results ?? []) {
                for (const [entryId, rawFields] of entries) {
                    const fields = toFieldMap(rawFields);
                    try {
                        await onEntry(fields);
                    } catch (err: unknown) {
                        console.error(
                            `[RedisSystemBus] handler error on ${stream} ${entryId}: ${(err as Error).message}`,
                        );
                    }
                    // Ack after the attempt: at-least-once on transport, with
                    // handler errors logged rather than poison-looping. A failed
                    // XACK must never be swallowed: the entry stays in the consumer
                    // group's pending list and is redelivered (no loss), so the
                    // failure is LOGGED rather than reported as a false ack.
                    try {
                        // biome-ignore lint/suspicious/noExplicitAny: ioredis stream commands lack public overloads
                        await (this._cmd as any).xack(stream, group, entryId);
                    } catch (err: unknown) {
                        console.error(
                            `[RedisSystemBus] XACK failed on ${stream} ${entryId} (will be redelivered): ${(err as Error).message}`,
                        );
                    }
                }
            }
        }
    }

    private async _stopLoop(loop: ConsumeLoop): Promise<void> {
        loop.running = false;
        this._loops.delete(loop);
        try {
            await loop.conn.quit();
        } catch (err: unknown) {
            // Quit failed; force the socket closed so the connection is not leaked.
            console.error(
                `[RedisSystemBus] consumer connection quit failed, forcing disconnect: ${(err as Error).message}`,
            );
            loop.conn.disconnect();
        }
    }

    private async _ensureGroup(stream: string, group: string): Promise<void> {
        try {
            // biome-ignore lint/suspicious/noExplicitAny: ioredis stream commands lack public overloads
            await (this._cmd as any).xgroup("CREATE", stream, group, "$", "MKSTREAM");
        } catch (err: unknown) {
            if (!(err as Error).message.includes("BUSYGROUP")) {
                throw err;
            }
        }
    }

    private async _xadd(stream: string, ...fieldArgs: string[]): Promise<void> {
        // biome-ignore lint/suspicious/noExplicitAny: ioredis stream commands lack public overloads
        await (this._cmd as any).xadd(stream, "MAXLEN", "~", this._maxLen, "*", ...fieldArgs);
    }
}

function toFieldMap(rawFields: string[]): Record<string, string> {
    const fields: Record<string, string> = {};
    for (let i = 0; i < rawFields.length; i += 2) {
        const k = rawFields[i];
        const v = rawFields[i + 1];
        if (k !== undefined && v !== undefined) {
            fields[k] = v;
        }
    }
    return fields;
}
