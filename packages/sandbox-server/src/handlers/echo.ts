import { okResult, errResult, TERN_TYPES, type TernRequest, type TernResult } from '@jasonscharf/core';
import type { HandlerContext } from '@jasonscharf/app';


interface EchoPayload {
    message: string;
}

/**
 * tern:echo — returns the caller's message back, uppercased, with a server
 * timestamp.  Registered via config/extensions/echo.yaml so no code changes
 * to the server entry-point are needed to add or remove it.
 */
export async function handleEcho(request: TernRequest, _ctx: HandlerContext): Promise<TernResult> {
    const payload = request.payload as Partial<EchoPayload> | undefined;

    if (!payload || typeof payload.message !== 'string') {
        return errResult(request.id, TERN_TYPES.echo, 'Payload must be { message: string }');
    }

    return okResult(request.id, TERN_TYPES.echo, {
        echo:       payload.message.toUpperCase(),
        original:   payload.message,
        receivedAt: Date.now(),
    });
}
