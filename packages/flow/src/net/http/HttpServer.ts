import type { IncomingMessage, ServerResponse } from "node:http";
import { getLogger, uuidv4Binary } from "@jasonscharf/core";
import { FlowComponent, type FlowComponentOptions } from "../../FlowComponent.js";
import type { FlowPort } from "../../FlowPort.js";
import { wire } from "../../FlowTransport.js";
import { HttpRequestReader } from "./HttpRequestReader.js";
import { HttpResponseWriter } from "./HttpResponseWriter.js";
import type {
    HttpHeaders,
    HttpMethod,
    HttpRequest,
    HttpResponse,
    HttpStreamResponse,
} from "./HttpTypes.js";

const log = getLogger("HttpServer");

/** Default maximum inbound request body size: 1 MiB. */
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

/** Default time (ms) allowed to receive the complete request. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** Default time (ms) allowed to receive the complete request headers. */
export const DEFAULT_HEADERS_TIMEOUT_MS = 10_000;

/** Default idle keep-alive timeout (ms) for persistent connections. */
export const DEFAULT_KEEP_ALIVE_TIMEOUT_MS = 5_000;

/**
 * Default socket inactivity timeout (ms). Unlike requestTimeout/headersTimeout
 * (which depend on the HTTP parser), this is the socket-level idle timer and
 * reliably reaps connections that connect then go silent (slowloris).
 */
export const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

export interface HttpServerOptions extends FlowComponentOptions {
    host?: string;
    port: number;
    /**
     * Maximum inbound request body size in bytes. Requests whose Content-Length
     * exceeds this, or which stream more bytes than this regardless of a stated
     * (or absent) Content-Length, are rejected with 413 and the socket is
     * destroyed. Defaults to {@link DEFAULT_MAX_BODY_BYTES} (1 MiB).
     */
    maxBodyBytes?: number;
    /**
     * Time (ms) the server waits to receive the entire request before aborting
     * the connection (mitigates slow-body attacks). Set to 0 to disable.
     * Defaults to {@link DEFAULT_REQUEST_TIMEOUT_MS}.
     */
    requestTimeoutMs?: number;
    /**
     * Time (ms) the server waits to receive the complete request headers before
     * aborting (mitigates slowloris). Set to 0 to disable. Defaults to
     * {@link DEFAULT_HEADERS_TIMEOUT_MS}.
     */
    headersTimeoutMs?: number;
    /**
     * Idle keep-alive timeout (ms) for persistent connections. Defaults to
     * {@link DEFAULT_KEEP_ALIVE_TIMEOUT_MS}.
     */
    keepAliveTimeoutMs?: number;
    /**
     * Socket inactivity timeout (ms). Reliably reaps connections that connect
     * then stop sending (slowloris) regardless of HTTP parser state. Set to 0
     * to disable. Defaults to {@link DEFAULT_IDLE_TIMEOUT_MS}.
     */
    idleTimeoutMs?: number;
    /**
     * Default security headers applied to every response unless overridden by
     * the response itself. Defaults to DEFAULT_SECURITY_HEADERS in
     * HttpResponseWriter.
     */
    securityHeaders?: HttpHeaders;
}

function hexId(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

function flattenHeaders(raw: IncomingMessage["headers"]): HttpHeaders {
    const out: HttpHeaders = {};
    for (const [k, v] of Object.entries(raw)) {
        if (v !== undefined) {
            out[k] = v;
        }
    }
    return out;
}

function toOutgoingHeaders(headers: HttpHeaders): Record<string, string | string[]> {
    const out: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(headers)) {
        out[k] = v;
    }
    return out;
}

/**
 * Composite Flow component that hosts an HTTP/1.1 server.
 *
 * Internal architecture:
 *   ┌───────────────────────────────────────────────────────────────┐
 *   │  HttpServer                                                   │
 *   │                                                               │
 *   │  http event ──► HttpRequestReader.out ──► requests (out)      │
 *   │                                                               │
 *   │  responses         (in) ──► step() ──► writer.in ──► res.end  │
 *   │  streamingResponses(in) ──► step() ──► _sendStream()          │
 *   └───────────────────────────────────────────────────────────────┘
 *
 * External ports:
 *   requests          (out) — HttpRequest for each inbound request
 *   responses         (in)  — HttpResponse (buffered body); must carry requestId
 *   streamingResponses(in)  — HttpStreamResponse (AsyncIterable body); must carry requestId
 */
export class HttpServer extends FlowComponent {
    readonly requests: FlowPort<HttpRequest>;
    readonly responses: FlowPort<HttpResponse>;
    readonly streamingResponses: FlowPort<HttpStreamResponse>;

    readonly reader: HttpRequestReader;
    readonly writer: HttpResponseWriter;

    private readonly _host?: string;
    private readonly _port: number;
    private readonly _maxBodyBytes: number;
    private readonly _requestTimeoutMs: number;
    private readonly _headersTimeoutMs: number;
    private readonly _keepAliveTimeoutMs: number;
    private readonly _idleTimeoutMs: number;
    private readonly _pending = new Map<string, ServerResponse>();

    constructor(options: HttpServerOptions) {
        super(options);
        this._host = options.host;
        this._port = options.port;
        this._maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
        this._requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
        this._headersTimeoutMs = options.headersTimeoutMs ?? DEFAULT_HEADERS_TIMEOUT_MS;
        this._keepAliveTimeoutMs = options.keepAliveTimeoutMs ?? DEFAULT_KEEP_ALIVE_TIMEOUT_MS;
        this._idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;

        this.requests = this.addPort<HttpRequest>("requests", "out");
        this.responses = this.addPort<HttpResponse>("responses", "in");
        this.streamingResponses = this.addPort<HttpStreamResponse>("streamingResponses", "in");

        this.reader = new HttpRequestReader({ name: `${this.name}.reader`, context: this.context });
        this.writer = new HttpResponseWriter({
            name: `${this.name}.writer`,
            context: this.context,
            securityHeaders: options.securityHeaders,
        });
        this.addChild(this.reader);
        this.addChild(this.writer);

        wire(this.reader.out, this.requests);

        this.writer._setSend((response) => {
            const requestId = response.requestId ?? "";
            const res = this._pending.get(requestId);
            if (!res) {
                return;
            }
            this._pending.delete(requestId);
            const headers = toOutgoingHeaders(response.headers ?? {});
            res.writeHead(response.status, response.statusText ?? "", headers);
            if (response.body != null) {
                res.end(response.body);
            } else {
                res.end();
            }
        });
    }

    protected override async onInit(): Promise<void> {
        const { createServer } = await import("node:http");

        const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
            const id = hexId(uuidv4Binary());
            this._pending.set(id, res);

            // Reject early if the declared Content-Length already exceeds the cap.
            const declared = Number(req.headers["content-length"]);
            if (Number.isFinite(declared) && declared > this._maxBodyBytes) {
                this._rejectTooLarge(id, res);
                return;
            }

            // Buffer body as raw bytes — the HttpDecoder handles content-type
            // parsing. Count streamed bytes so a lying or absent Content-Length
            // is still caught.
            const chunks: Buffer[] = [];
            let received = 0;
            try {
                for await (const chunk of req) {
                    const buf = chunk as Buffer;
                    received += buf.length;
                    if (received > this._maxBodyBytes) {
                        this._rejectTooLarge(id, res);
                        return;
                    }
                    chunks.push(buf);
                }
            } catch {
                // Aborted/destroyed connections surface as iterator errors; the
                // pending entry is cleaned up and there is nothing to respond to.
                this._pending.delete(id);
                return;
            }
            const raw = Buffer.concat(chunks);

            this.reader._inject({
                requestId: id,
                method: (req.method ?? "GET") as HttpMethod,
                url: req.url ?? "/",
                headers: flattenHeaders(req.headers),
                remoteAddress: req.socket?.remoteAddress ?? undefined,
                body:
                    raw.length > 0
                        ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
                        : undefined,
            });
        });

        // Connection-level limits to mitigate slowloris / slow-body attacks.
        server.requestTimeout = this._requestTimeoutMs;
        server.headersTimeout = this._headersTimeoutMs;
        server.keepAliveTimeout = this._keepAliveTimeoutMs;
        server.timeout = this._idleTimeoutMs;

        this.addDisposable({
            dispose: () =>
                new Promise<void>((resolve) => {
                    server.closeAllConnections?.();
                    server.close(() => resolve());
                }),
        });

        await new Promise<void>((resolve, reject) => {
            server.listen(this._port, this._host ?? "127.0.0.1", resolve);
            server.once("error", reject);
        });
    }

    /**
     * Sends a 413 Payload Too Large response and destroys the socket so the
     * client cannot keep streaming. Idempotent against the pending map.
     */
    private _rejectTooLarge(id: string, res: ServerResponse): void {
        this._pending.delete(id);
        if (!res.headersSent && !res.writableEnded) {
            res.writeHead(413, "Payload Too Large", {
                "content-type": "text/plain",
                connection: "close",
            });
            res.end("Payload Too Large");
        }
        res.destroy();
    }

    override step(): void {
        // Buffered responses → writer
        for (;;) {
            const resp = this.responses.read();
            if (resp === undefined) {
                break;
            }
            this.writer.in.put(resp);
        }

        // Streaming responses — kick off async pipe for each
        for (;;) {
            const stream = this.streamingResponses.read();
            if (stream === undefined) {
                break;
            }
            // Detached stream pipe: register as in-flight work so FlowApp.stop()
            // drains an in-progress response before disposing (graceful-drain
            // contract, TRN-472). _sendStream never rejects — a body-generator
            // failure destroys the socket rather than becoming an unhandled
            // rejection (TRN-528).
            this.trackInFlight(this._sendStream(stream));
        }
    }

    private async _sendStream(response: HttpStreamResponse): Promise<void> {
        const res = this._pending.get(response.requestId);
        if (!res) {
            return;
        }
        this._pending.delete(response.requestId);

        const headers = toOutgoingHeaders(response.headers);
        res.writeHead(response.status, response.statusText ?? "", headers);

        try {
            for await (const chunk of response.body) {
                if (!res.writableEnded) {
                    res.write(chunk);
                }
            }
        } catch (err) {
            // The body generator failed mid-stream. Headers are already sent, so
            // the only correct signal is to destroy the socket; log the cause so
            // the failure is not silently swallowed (TRN-528).
            const message = err instanceof Error ? err.message : String(err);
            log.error("streaming response failed", {
                component: this.name,
                requestId: response.requestId,
                error: message,
            });
            if (!res.writableEnded) {
                res.destroy();
            }
            return;
        }

        if (!res.writableEnded) {
            res.end();
        }
    }
}
