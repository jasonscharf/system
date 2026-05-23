import type { HandlerContext } from "@jasonscharf/app";
import { okResult, TERN_TYPES, type TernRequest, type TernResult } from "@jasonscharf/core";

export async function handlePing(request: TernRequest, _ctx: HandlerContext): Promise<TernResult> {
    return okResult(request.id, TERN_TYPES.ping, { ts: Date.now() });
}
