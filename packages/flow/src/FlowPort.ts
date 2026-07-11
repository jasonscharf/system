import type { FlowComponent } from "./FlowComponent.js";
import type { FlowTransport } from "./FlowTransport.js";
import { isTickEvent } from "./TickEvent.js";
import type { PortDirection, ReadMode } from "./types.js";

/**
 * Upper bound on messages retained by an out port that has NO transport bound
 * (TRN-525). An out port is an edge, not a buffer: once a transport is bound it
 * delivers without retaining. The only reason to keep anything is so a test can
 * read an unwired out port back as a Collector, and those reads are prompt and
 * small. Bounding the queue guarantees an out port that is never wired and never
 * read can still not grow for the life of a long-running process.
 */
const OUT_PORT_MAX_RETAINED = 1024;

export class FlowPort<T> {
    readonly name: string;
    readonly direction: PortDirection;
    readonly owner: FlowComponent;

    private readonly _queue: T[] = [];
    private readonly _transports: FlowTransport<T>[] = [];
    private readonly _handlers: Array<(msg: T) => void> = [];

    constructor(name: string, direction: PortDirection, owner: FlowComponent) {
        this.name = name;
        this.direction = direction;
        this.owner = owner;
    }

    get size(): number {
        return this._queue.length;
    }

    /**
     * True when at least one listener has been registered via `on()`.
     * Unbound inbound ports silently discard TickEvents.
     */
    get isBound(): boolean {
        return this._handlers.length > 0;
    }

    /**
     * Register a handler to be called during the owning component's step().
     * If a component overrides step() directly, handlers registered here
     * are only invoked if super.step() is called.
     */
    on(handler: (msg: T) => void): void {
        this._handlers.push(handler);
    }

    peek(): T | undefined {
        return this._queue[0];
    }

    read(): T | undefined {
        return this._queue.shift();
    }

    put(msg: T): void {
        if (this.direction === "in") {
            if (isTickEvent(msg) && !this.isBound) {
                return;
            }
            this._queue.push(msg);
            this.owner.context.scheduler?.enqueue(this.owner);
            return;
        }
        // Out ports are edges, not buffers (TRN-525). When a transport is bound
        // we deliver WITHOUT enqueueing — nothing ever drains an out port's
        // queue, so retaining every delivered message is an unbounded leak on a
        // long-running server. Only when no transport is bound do we retain the
        // message, so a test can read the port back as a Collector, and we cap
        // that queue so an unwired, unread out port still cannot grow forever.
        if (this._transports.length > 0) {
            for (const transport of this._transports) {
                transport.deliver(msg);
            }
            return;
        }
        this._queue.push(msg);
        if (this._queue.length > OUT_PORT_MAX_RETAINED) {
            this._queue.shift();
        }
    }

    /**
     * Called by FlowComponent.step() to dispatch queued messages to registered
     * handlers. If no handlers are registered this is a no-op.
     */
    dispatch(readMode: ReadMode): void {
        if (this._handlers.length === 0) {
            return;
        }
        if (readMode === "drain") {
            for (;;) {
                const msg = this._queue.shift();
                if (msg === undefined) {
                    break;
                }
                this._dispatchOne(msg);
            }
        } else {
            const msg = this._queue.shift();
            if (msg !== undefined) {
                this._dispatchOne(msg);
            }
        }
    }

    private _dispatchOne(msg: T): void {
        const fire = (): void => {
            for (const h of this._handlers) {
                h(msg);
            }
        };
        const scheduler = this.owner.context.scheduler;
        if (scheduler === undefined) {
            fire();
            return;
        }
        scheduler.dispatch(this as unknown as FlowPort<unknown>, msg, fire);
    }

    addTransport(transport: FlowTransport<T>): void {
        this._transports.push(transport);
    }
}
