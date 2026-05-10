import { uuidv4Binary } from '@system/core';


export interface FlowMessage<T = unknown> {
    readonly id: Uint8Array;
    readonly timestamp: number;
    readonly type?: string;
    readonly payload: T;
}

export function createMessage<T>(payload: T, type?: string): FlowMessage<T> {
    return {
        id: uuidv4Binary(),
        timestamp: Date.now(),
        type,
        payload,
    };
}
