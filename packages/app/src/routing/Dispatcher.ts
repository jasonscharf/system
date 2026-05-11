import type { TernRequest, TernResult } from '@system/core';


/**
 * Minimal dispatch contract shared by TernRouter, HandlerRegistry, and any
 * other object that can process a TernRequest.  MessageRouter accepts any
 * Dispatcher so the two implementations are interchangeable.
 */
export interface Dispatcher {
    dispatch(request: TernRequest, extras: Record<string, unknown>): Promise<TernResult>;
}
