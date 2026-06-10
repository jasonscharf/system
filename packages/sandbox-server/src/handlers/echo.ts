import type { HandlerContext } from "@jasonscharf/app";
import {
    errResult,
    okResult,
    SYSTEM_TYPES,
    type SystemRequest,
    type SystemResult,
} from "@jasonscharf/core";

interface EchoPayload {
    message: string;
}

/**
 * urn:sys:core:msg:echo — returns the caller's message back, uppercased, with a server
 * timestamp.  Registered via config/extensions/echo.yaml so no code changes
 * to the server entry-point are needed to add or remove it.
 */
export async function handleEcho(request: SystemRequest, _ctx: HandlerContext): Promise<SystemResult> {
    const payload = request.payload as Partial<EchoPayload> | undefined;

    if (!payload || typeof payload.message !== "string") {
        return errResult(request.id, SYSTEM_TYPES.echo, "Payload must be { message: string }");
    }

    return okResult(request.id, SYSTEM_TYPES.echo, {
        echo: payload.message.toUpperCase(),
        original: payload.message,
        receivedAt: Date.now(),
    });
}
