export type HttpMethod =
    | "GET"
    | "POST"
    | "PUT"
    | "PATCH"
    | "DELETE"
    | "HEAD"
    | "OPTIONS"
    | "TRACE"
    | "CONNECT";

/** Header map — values may be multi-valued (e.g. Set-Cookie). */
export type HttpHeaders = Record<string, string | string[]>;

// ── Wire-format messages (body already serialised to bytes/text) ──────────────

/** An HTTP request as it travels the network or enters the Flow graph. */
export interface HttpRequest {
    /** Populated by HttpServer to correlate a response back to its connection. */
    requestId?: string;
    method: HttpMethod;
    url: string;
    headers: HttpHeaders;
    body?: string | Uint8Array;
    /** Socket peer address, set by HttpServer. Used for trusted-proxy IP resolution. */
    remoteAddress?: string;
}

/** An HTTP response as it travels the network or exits the Flow graph. */
export interface HttpResponse {
    /** Echo of HttpRequest.requestId when responding via HttpServer. */
    requestId?: string;
    status: number;
    statusText?: string;
    headers: HttpHeaders;
    body?: string | Uint8Array;
}

// ── Draft messages (body not yet serialised — encoder input) ─────────────────

/** HttpRequest before body encoding; the body may be any JS value. */
export interface HttpRequestDraft {
    requestId?: string;
    method?: HttpMethod;
    url: string;
    headers?: HttpHeaders;
    body?: unknown;
    /** Explicit MIME type; if omitted the encoder infers from body type. */
    contentType?: string;
}

/** HttpResponse before body encoding; the body may be any JS value. */
export interface HttpResponseDraft {
    requestId?: string;
    /** Defaults to 200. */
    status?: number;
    statusText?: string;
    headers?: HttpHeaders;
    body?: unknown;
    contentType?: string;
}

// ── Parsed messages (body already deserialised — decoder output) ─────────────

/** HttpRequest after body decoding; the body is a parsed JS value. */
export interface ParsedHttpRequest {
    requestId?: string;
    method: HttpMethod;
    url: string;
    /** Path component of url, e.g. "/users". */
    pathname: string;
    /** Parsed query string. */
    searchParams: URLSearchParams;
    headers: HttpHeaders;
    body?: unknown;
    contentType?: string;
    /** Socket peer address, set by HttpServer. Used for trusted-proxy IP resolution. */
    remoteAddress?: string;
}

/** HttpResponse after body decoding; the body is a parsed JS value. */
export interface ParsedHttpResponse {
    requestId?: string;
    status: number;
    statusText?: string;
    /** true when status is 2xx. */
    ok: boolean;
    headers: HttpHeaders;
    body?: unknown;
    contentType?: string;
}

// ── Streaming response ────────────────────────────────────────────────────────

/**
 * A response whose body is produced by an AsyncIterable rather than held
 * in memory all at once. Used with HttpServer.streamingResponses.
 *
 * Chunks are piped directly to the underlying ServerResponse via
 * `res.write()` so arbitrarily large files can be served without buffering.
 */
export interface HttpStreamResponse {
    /** Must match the requestId from the inbound HttpRequest. */
    requestId: string;
    status: number;
    statusText?: string;
    headers: HttpHeaders;
    body: AsyncIterable<Uint8Array>;
}
