export type PortDirection = "in" | "out";

export type ReadMode = "once" | "drain";

export type ScheduleMode = "push" | "pull";

export type ComponentState = "idle" | "running" | "disposed";

export type ID = bigint | Uint8Array;

export interface IDisposable {
    dispose(): void | Promise<void>;
}
