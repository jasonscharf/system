import { FlowComponent } from "./FlowComponent.js";
import type { FlowContext } from "./FlowContext.js";
import { TickEvent } from "./TickEvent.js";

export interface ClockConfig {
    intervalMs: number;
    name?: string;
}

/**
 * Emits a TickEvent on `out` at a fixed interval.
 *
 * Controlled entirely via the inherited inControl port:
 *   inControl.put(Control.start())   — start the timer
 *   inControl.put(Control.stop())    — stop the timer
 *   inControl.put(Control.pause())   — pause (timer halted, paused=true)
 *   inControl.put(Control.resume())  — resume from pause or stop
 *
 * Auto-starts on app.start() (onInit) and auto-stops on app.stop() (onDispose).
 *
 * In tests, pair with vi.useFakeTimers() / vi.advanceTimersByTime() to control
 * emission without waiting for real wall-clock time.
 */
export class Clock extends FlowComponent {
    readonly out = this.addPort<TickEvent>("out", "out");

    private _timer?: ReturnType<typeof setInterval>;
    private _paused = false;
    readonly intervalMs: number;

    constructor(ctx: FlowContext, config: ClockConfig) {
        super({ name: config.name ?? "clock", context: ctx });
        this.intervalMs = config.intervalMs;
    }

    get running(): boolean {
        return this._timer != null;
    }

    get paused(): boolean {
        return this._paused;
    }

    protected override onStart(): void { this._startTimer(); this._paused = false; }
    protected override onResume(_wasStopped: boolean, _since: number): void { this._startTimer(); this._paused = false; }
    protected override onPause(): void { this._stopTimer(); this._paused = true; }
    protected override onStop(): void { this._stopTimer(); this._paused = false; }

    protected override onInit(): void { this._startTimer(); }
    protected override onDispose(): void { this._stopTimer(); }

    private _startTimer(): void {
        if (this._timer != null) {
            return;
        }
        this._timer = setInterval(() => {
            this.out.put(new TickEvent());
        }, this.intervalMs);
    }

    private _stopTimer(): void {
        if (this._timer == null) {
            return;
        }
        clearInterval(this._timer);
        this._timer = undefined;
    }
}
