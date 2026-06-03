export interface StartSignal {
    readonly type: "start";
}

export interface StopSignal {
    readonly type: "stop";
    readonly timestamp: number;
}

export interface PauseSignal {
    readonly type: "pause";
    readonly timestamp: number;
}

export interface ResumeSignal {
    readonly type: "resume";
    /** True when the component was fully stopped (vs paused). */
    readonly wasStopped: boolean;
    /** Timestamp of the pause or stop that preceded this resume. */
    readonly since: number;
}

export type ControlSignal = StartSignal | StopSignal | PauseSignal | ResumeSignal;

/** Factory helpers — always prefer these over constructing signals by hand. */
export const Control = {
    start: (): StartSignal => ({ type: "start" }),
    stop: (): StopSignal => ({ type: "stop", timestamp: Date.now() }),
    pause: (): PauseSignal => ({ type: "pause", timestamp: Date.now() }),
    resume: (wasStopped: boolean, since: number): ResumeSignal => ({
        type: "resume",
        wasStopped,
        since,
    }),
} as const;
