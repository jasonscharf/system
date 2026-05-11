import { okResult, TERN_TYPES, type TernRequest, type TernResult } from '@system/core';
import type { HandlerContext } from '@system/app';


export async function handlePing(request: TernRequest, _ctx: HandlerContext): Promise<TernResult> {
    return okResult(request.id, TERN_TYPES.ping, { ts: Date.now() });
}
