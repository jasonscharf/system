import type { IncomingMessage, ServerResponse } from "node:http";
import { uuidv4Binary } from "@jasonscharf/core";
import { FlowComponent, type FlowComponentOptions } from "../../FlowComponent.js";
import type { FlowPort } from "../../FlowPort.js";
import { LocalTransport } from "../../FlowTransport.js";
import { HttpRequestReader } from "./HttpRequestReader.js";
import { HttpResponseWriter } from "./HttpResponseWriter.js";
import type {
    HttpHeaders,
    HttpMethod,
    HttpRequest,
    HttpResponse,
    HttpStreamResponse,
} from "./HttpTypes.js";

export interface HttpServerOptions extends FlowComponentOptions {
    host?: string;
    port: number;
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
    private readonly _pending = new Map<string, ServerResponse>();

    constructor(options: HttpServerOptions) {
        super(options);
        this._host = options.host;
        this._port = options.port;

        this.requests = this.addPort<HttpRequest>("requests", "out");
        this.responses = this.addPort<HttpResponse>("responses", "in");
        this.streamingResponses = this.addPort<HttpStreamResponse>("streamingResponses", "in");

        this.reader = new HttpRequestReader({ name: `${this.name}.reader`, context: this.context });
        this.writer = new HttpResponseWriter({
            name: `${this.name}.writer`,
            context: this.context,
        });
        this.addChild(this.reader);
        this.addChild(this.writer);

        this.reader.out._addTransport(new LocalTransport(this.reader.out, this.requests));

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

            // Buffer body as raw bytes — the HttpDecoder handles content-type parsing.
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
                chunks.push(chunk as Buffer);
            }
            const raw = Buffer.concat(chunks);

            this.reader._inject({
                requestId: id,
                method: (req.method ?? "GET") as HttpMethod,
                url: req.url ?? "/",
                headers: flattenHeaders(req.headers),
                body:
                    raw.length > 0
                        ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
                        : undefined,
            });
        });

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
            void this._sendStream(stream);
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
        } catch {
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
