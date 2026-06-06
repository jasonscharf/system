import pino from "pino";
import { trace } from "@opentelemetry/api";
import type { Logger } from "@jasonscharf/core";

export class PinoLogger implements Logger {
    private readonly _pino: pino.Logger;

    constructor(name: string) {
        this._pino = pino({
            name,
            level: process.env.LOG_LEVEL ?? "info",
            mixin() {
                const span = trace.getActiveSpan();
                if (!span) return {};
                const { traceId, spanId } = span.spanContext();
                return { trace_id: traceId, span_id: spanId };
            },
            transport:
                process.env.NODE_ENV !== "production"
                    ? { target: "pino-pretty", options: { colorize: true } }
                    : undefined,
        });
    }

    debug(msg: string, meta?: Record<string, unknown>): void {
        this._pino.debug(meta ?? {}, msg);
    }

    info(msg: string, meta?: Record<string, unknown>): void {
        this._pino.info(meta ?? {}, msg);
    }

    warn(msg: string, meta?: Record<string, unknown>): void {
        this._pino.warn(meta ?? {}, msg);
    }

    error(msg: string, meta?: Record<string, unknown>): void {
        this._pino.error(meta ?? {}, msg);
    }
}
