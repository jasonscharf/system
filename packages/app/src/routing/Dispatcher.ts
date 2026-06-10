import type { SystemRequest, SystemResult } from "@jasonscharf/core";

/**
 * Minimal dispatch contract shared by SystemRouter, HandlerRegistry, and any
 * other object that can process a SystemRequest.  MessageRouter accepts any
 * Dispatcher so the two implementations are interchangeable.
 */
export interface Dispatcher {
    dispatch(request: SystemRequest, extras: Record<string, unknown>): Promise<SystemResult>;
}
