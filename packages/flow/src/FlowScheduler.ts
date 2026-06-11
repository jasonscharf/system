import type { FlowComponent } from "./FlowComponent.js";
import type { FlowPort } from "./FlowPort.js";
import type { ScheduleMode } from "./types.js";

export abstract class FlowScheduler {
    protected _running = false;

    abstract get mode(): ScheduleMode;
    abstract get queueSize(): number;
    abstract enqueue(component: FlowComponent): void;

    /**
     * Deliver one message to a port's handlers. Ports report the put side via
     * enqueue(); this is the matching delivery side. The default fires
     * immediately. Subclasses may override to observe, gate, or account for
     * every message in the graph — not calling fire() holds the message (it
     * has already left the queue), making the scheduler responsible for
     * redelivery via port.put().
     */
    dispatch(_port: FlowPort<unknown>, _msg: unknown, fire: () => void): void {
        fire();
    }

    /** Process one scheduling cycle. */
    abstract tick(): Promise<void>;

    start(): void {
        this._running = true;
    }

    stop(): void {
        this._running = false;
    }
}

/**
 * Reactive push scheduler — only processes work when components are enqueued.
 *
 * Each enqueue() schedules a flush via setTimeout(fn, 0) so the flush runs as
 * a macrotask. This lets the Node.js event loop handle I/O (HTTP, WebSockets,
 * timers) between scheduler ticks — no tight microtask loop, no I/O starvation.
 */
export class PushScheduler extends FlowScheduler {
    private readonly _queue: FlowComponent[] = [];
    private _flushPending = false;

    override get mode(): ScheduleMode {
        return "push";
    }

    override get queueSize(): number {
        return this._queue.length;
    }

    override enqueue(component: FlowComponent): void {
        this._queue.push(component);
        this._scheduleFlush();
    }

    private _scheduleFlush(): void {
        if (this._flushPending) {
            return;
        }
        this._flushPending = true;
        setTimeout(() => {
            this._flushPending = false;
            if (this._running) {
                void this.tick().then(() => {
                    if (this._queue.length > 0) {
                        this._scheduleFlush();
                    }
                });
            }
        }, 0);
    }

    override async tick(): Promise<void> {
        const batch = this._queue.splice(0);
        for (const component of batch) {
            const result = component.step();
            if (result instanceof Promise) {
                await result;
            }
        }
    }
}

/**
 * Pull scheduler — steps all components in topological order on each tick().
 * Intended for controlled, deterministic pipelines; call tick() manually or
 * via drain() rather than relying on background scheduling.
 */
export class PullScheduler extends FlowScheduler {
    private _order: FlowComponent[] = [];

    override get mode(): ScheduleMode {
        return "pull";
    }

    override get queueSize(): number {
        return 0;
    }

    override enqueue(_component: FlowComponent): void {
        // Pull mode is driven by tick(), not reactive enqueue
    }

    _setPullOrder(components: FlowComponent[]): void {
        this._order = components;
    }

    override async tick(): Promise<void> {
        for (const component of this._order) {
            const result = component.step();
            if (result instanceof Promise) {
                await result;
            }
        }
    }
}
