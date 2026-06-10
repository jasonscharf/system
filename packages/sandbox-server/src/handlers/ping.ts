import type { HandlerContext } from "@jasonscharf/app";
import { okResult, SYSTEM_TYPES, type SystemRequest, type SystemResult } from "@jasonscharf/core";

export async function handlePing(request: SystemRequest, _ctx: HandlerContext): Promise<SystemResult> {
    return okResult(request.id, SYSTEM_TYPES.ping, { ts: Date.now() });
}
