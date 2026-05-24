import type { FlowComponent } from "./FlowComponent.js";
import type { ScheduleMode } from "./types.js";

export abstract class FlowScheduler {
    protected _running = false;

    abstract get mode(): ScheduleMode;
    abstract get queueSize(): number;
    abstract enqueue(component: FlowComponent): void;

    /** Process one scheduling cycle. */
    abstract tick(): void;

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
            this.tick();
            await new Promise<void>((r) => setTimeout(r, 0));
        }
    }
}

export class PushScheduler extends FlowScheduler {
    private readonly _queue = new Set<FlowComponent>();

    override get mode(): ScheduleMode {
        return "push";
    }

    override get queueSize(): number {
        return this._queue.size;
    }

    override enqueue(component: FlowComponent): void {
        this._queue.add(component);
    }

    override tick(): void {
        const batch = [...this._queue];
        this._queue.clear();
        for (const component of batch) {
            component.step();
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

    override tick(): void {
        for (const component of this._order) {
            component.step();
        }
    }
}
