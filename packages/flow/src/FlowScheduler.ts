import type { FlowComponent } from "./FlowComponent.js";
import type { ScheduleMode } from "./types.js";

export abstract class FlowScheduler {
    protected _running = false;

    abstract get mode(): ScheduleMode;
    abstract get queueSize(): number;
    abstract enqueue(component: FlowComponent): void;

    /** Process one scheduling cycle. May be async if any component's step() is async. */
    abstract tick(): Promise<void>;

    start(): void {
        if (this._running) {
            return;
        }
        this._running = true;
        void this._loop();
    }

    stop(): void {
        this._running = false;
    }

    private async _loop(): Promise<void> {
        while (this._running) {
            await this.tick();
        }
    }
}

export class PushScheduler extends FlowScheduler {
    private readonly _queue: FlowComponent[] = [];

    override get mode(): ScheduleMode {
        return "push";
    }

    override get queueSize(): number {
        return this._queue.length;
    }

    override enqueue(component: FlowComponent): void {
        this._queue.push(component);
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
