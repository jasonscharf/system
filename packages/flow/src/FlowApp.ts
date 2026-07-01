import type { FlowComponent } from "./FlowComponent.js";
import { FlowContext } from "./FlowContext.js";
import type { FlowPort } from "./FlowPort.js";
import { type FlowScheduler, PullScheduler, PushScheduler } from "./FlowScheduler.js";
import { FlowTransport, LocalTransport } from "./FlowTransport.js";
import type { ScheduleMode } from "./types.js";

export interface FlowAppOptions {
    mode?: ScheduleMode;
    scheduler?: FlowScheduler;
}

/** Upper bound on the stop() shutdown drain before disposing anyway. */
const DEFAULT_STOP_DRAIN_TIMEOUT_MS = 30_000;

/** Idle wait between shutdown-drain ticks while in-flight work settles. */
const STOP_DRAIN_POLL_MS = 10;

interface Connection {
    transport: FlowTransport<unknown>;
    fromOwner: FlowComponent;
    toOwner: FlowComponent;
}

export class FlowApp {
    readonly context: FlowContext;
    readonly scheduler: FlowScheduler;

    private readonly _components = new Set<FlowComponent>();
    private readonly _connections: Connection[] = [];

    constructor(options: FlowAppOptions = {}) {
        this.context = new FlowContext();
        this.scheduler =
            options.scheduler ??
            ((options.mode ?? "push") === "pull" ? new PullScheduler() : new PushScheduler());
        this.context._setScheduler(this.scheduler);
    }

    get components(): ReadonlySet<FlowComponent> {
        return this._components;
    }

    addComponent(component: FlowComponent): this {
        this._components.add(component);
        this._updatePullOrder();
        return this;
    }

    /**
     * Wire an outbound port to a destination.
     *
     * Full connection (local):
     *   app.connect(out, in)                   — LocalTransport (in-memory)
     *   app.connect(out, in, new RedisTransport()) — custom transport
     *
     * Sink connection (external):
     *   app.connect(out, new RedisTransport("stream-id"))
     *   The transport owns delivery; no local inbound port is involved.
     */
    connect<T>(from: FlowPort<T>, to: FlowPort<T>, transport?: FlowTransport<T>): this;
    connect<T>(from: FlowPort<T>, transport: FlowTransport<T>): this;
    connect<T>(
        from: FlowPort<T>,
        toOrTransport: FlowPort<T> | FlowTransport<T>,
        transport?: FlowTransport<T>,
    ): this {
        if (toOrTransport instanceof FlowTransport) {
            // Sink form: connect(out, transport)
            toOrTransport._attach(from, undefined);
            from.addTransport(toOrTransport);
            this._components.add(from.owner);
        } else {
            // Full form: connect(out, in, transport?)
            const t = transport ?? new LocalTransport<T>();
            t._attach(from, toOrTransport);
            from.addTransport(t);
            this._components.add(from.owner);
            this._components.add(toOrTransport.owner);
            this._connections.push({
                transport: t as FlowTransport<unknown>,
                fromOwner: from.owner,
                toOwner: toOrTransport.owner,
            });
            this._updatePullOrder();
        }
        return this;
    }

    /**
     * Initialise all components without starting the background scheduler loop.
     * Source components emit their data during onInit(), so the scheduler queue
     * is populated and ready for a subsequent drain() call.
     *
     * Prefer this over start() in tests — drain() is then the single controlled
     * processing step, with no concurrent background loop to race against.
     */
    async init(): Promise<void> {
        for (const component of this._components) {
            await component.init();
        }
    }

    /** Initialise all components and start the continuous background scheduler loop. */
    async start(): Promise<void> {
        await this.init();
        this.scheduler.start();
    }

    /**
     * Graceful shutdown (TRN-472). Three phases:
     *   1. Quiesce - every component stops taking NEW work (sources stop
     *      pulling, pollers stop their timers) but keeps its resources open.
     *   2. Drain - the background loop is stopped and the graph is ticked
     *      manually (single driver) until it is idle: no queued steps, no
     *      in-flight tracked tasks, and no pending message still making
     *      progress. This lets already-accepted work finish and its feedback
     *      (e.g. a consumer's broker ack) be fully processed BEFORE anything
     *      is disposed - disposing mid-ack is how a delivered message gets
     *      redelivered and double-processed.
     *   3. Dispose - components are disposed in reverse insertion order.
     * The drain is bounded by drainTimeoutMs; on timeout the app disposes
     * anyway (unfinished work stays unacked and is redelivered, never lost).
     */
    async stop(drainTimeoutMs = DEFAULT_STOP_DRAIN_TIMEOUT_MS): Promise<void> {
        for (const component of this._components) {
            await component.quiesce();
        }
        this.scheduler.stop();
        await this._drainForStop(drainTimeoutMs);
        const all = [...this._components].reverse();
        for (const component of all) {
            await component.dispose();
        }
    }

    /**
     * Process a single scheduling cycle. Delegates to the active scheduler.
     * Useful when you want precise tick-by-tick control in tests or pull mode.
     */
    async tick(): Promise<void> {
        await this.scheduler.tick();
    }

    /**
     * Run the graph to quiescence — ticks until no component has pending
     * scheduled work AND no inbound port holds unprocessed messages.
     * Guards against cycles with maxTicks (default 1000).
     */
    async drain(maxTicks = 1000): Promise<void> {
        let remaining = maxTicks;
        while (remaining-- > 0) {
            if (this.scheduler.queueSize === 0 && !this._hasPendingMessages()) {
                break;
            }
            await this.scheduler.tick();
        }
    }

    private _hasPendingMessages(): boolean {
        return this._pendingMessageCount() > 0;
    }

    private _pendingMessageCount(): number {
        let count = 0;
        for (const c of this._components) {
            if (!c.isRunning) {
                continue; // paused/stopped components won't process their queued data
            }
            for (const [, port] of c.ports) {
                if (port.direction === "in") {
                    count += port.size;
                }
            }
        }
        return count;
    }

    private _inFlightCount(): number {
        let count = 0;
        for (const c of this._components) {
            count += c.inFlight;
        }
        return count;
    }

    /**
     * Shutdown drain: tick until the graph is provably done. "Done" is an
     * empty scheduler queue, zero in-flight tracked tasks, and a pending
     * message count that did not move across the last tick - a message no
     * step() ever consumes (an unbound port) must not hold shutdown open,
     * because after quiesce nothing new is produced into it.
     */
    private async _drainForStop(timeoutMs: number): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        let lastPending = this._pendingMessageCount();
        for (;;) {
            await this.scheduler.tick();
            const pending = this._pendingMessageCount();
            const stalled = pending === lastPending;
            lastPending = pending;
            if (this.scheduler.queueSize === 0 && this._inFlightCount() === 0 && stalled) {
                return;
            }
            if (Date.now() >= deadline) {
                return;
            }
            await new Promise<void>((resolve) => setTimeout(resolve, STOP_DRAIN_POLL_MS));
        }
    }

    private _updatePullOrder(): void {
        if (!(this.scheduler instanceof PullScheduler)) {
            return;
        }
        this.scheduler._setPullOrder(this._topoSort());
    }

    private _topoSort(): FlowComponent[] {
        const inDegree = new Map<FlowComponent, number>();
        const adj = new Map<FlowComponent, Set<FlowComponent>>();

        for (const c of this._components) {
            inDegree.set(c, 0);
            adj.set(c, new Set());
        }

        for (const { fromOwner, toOwner } of this._connections) {
            if (fromOwner === toOwner) {
                continue;
            }
            const neighbors = adj.get(fromOwner);
            if (neighbors == null) {
                throw new Error("_topoSort: missing adjacency entry for fromOwner");
            }
            if (!neighbors.has(toOwner)) {
                neighbors.add(toOwner);
                const cur = inDegree.get(toOwner);
                if (cur == null) {
                    throw new Error("_topoSort: missing inDegree entry for toOwner");
                }
                inDegree.set(toOwner, cur + 1);
            }
        }

        const queue: FlowComponent[] = [];
        for (const [c, deg] of inDegree) {
            if (deg === 0) {
                queue.push(c);
            }
        }

        const sorted: FlowComponent[] = [];
        while (queue.length > 0) {
            const node = queue.shift();
            if (node == null) {
                break;
            }
            sorted.push(node);
            const nodeNeighbors = adj.get(node);
            if (nodeNeighbors == null) {
                throw new Error("_topoSort: missing adjacency entry for node");
            }
            for (const neighbor of nodeNeighbors) {
                const deg = inDegree.get(neighbor);
                if (deg == null) {
                    throw new Error("_topoSort: missing inDegree entry for neighbor");
                }
                const newDeg = deg - 1;
                inDegree.set(neighbor, newDeg);
                if (newDeg === 0) {
                    queue.push(neighbor);
                }
            }
        }

        return sorted;
    }
}
