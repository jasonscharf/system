import type { HandlerContext } from "@terncosoftware/app";
import { okResult, SYSTEM_TYPES, type SystemRequest, type SystemResult } from "@terncosoftware/core";

export async function handlePing(request: SystemRequest, _ctx: HandlerContext): Promise<SystemResult> {
    return okResult(request.id, SYSTEM_TYPES.ping, { ts: Date.now() });
}
