export type PortDirection = 'in' | 'out';

export type ScheduleMode = 'push' | 'pull';

export type ComponentState = 'idle' | 'running' | 'disposed';

export type ID = BigInt | Uint8Array;

export interface IDisposable {
    dispose(): void | Promise<void>;
}
