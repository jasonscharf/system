import type { FlowScheduler } from "./FlowScheduler.js";

export class FlowContext {
    private _scheduler?: FlowScheduler;

    get scheduler(): FlowScheduler | undefined {
        return this._scheduler;
    }

    _setScheduler(scheduler: FlowScheduler): void {
        this._scheduler = scheduler;
    }
}
