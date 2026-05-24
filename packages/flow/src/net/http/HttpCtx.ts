import type { HttpHeaders, HttpMethod, ParsedHttpRequest } from "./HttpTypes.js";

/**
 * Request/response context for HttpRouter middleware — modelled after Koa's ctx.
 *
 * Handlers read from `ctx.req` and write to `ctx.status`, `ctx.headers`, and
 * `ctx.body`.  Arbitrary extras (database handles, loggers, …) added via the
 * router constructor are accessible via the index signature `ctx['store']`.
 */
export class HttpCtx implements Record<string, unknown> {
    [key: string]: unknown;

    /** The fully decoded inbound request. */
    readonly req: ParsedHttpRequest;

    /** Path parameters extracted by the matched route pattern, e.g. `{ id: '42' }`. */
    params: Record<string, string>;

    /** Parsed query string from the request URL. */
    readonly query: URLSearchParams;

    /** HTTP status code to send.  Default: 200. */
    status: number;

    /** Response headers to send.  Populated by handlers / encoder. */
    headers: HttpHeaders;

    /**
     * Response body.  Any serialisable value — the HttpEncoder infers
     * Content-Type from the body type unless `ctx.headers['content-type']` is
     * already set.  Set to `undefined` (default) for a body-less response.
     */
    body: unknown;

    constructor(req: ParsedHttpRequest, extras: Record<string, unknown> = {}) {
        this.req = req;
        this.params = {};
        this.query = req.searchParams;
        this.status = 200;
        this.headers = {};
        this.body = undefined;
        // Merge app extras (store, logger, etc.) directly onto ctx
        Object.assign(this, extras);
    }

    /** Shorthand: set status and body together. */
    send(status: number, body: unknown): void {
        this.status = status;
        this.body = body;
    }

    /** Shorthand: 400 Bad Request. */
    badRequest(message = "Bad Request"): void {
        this.send(400, { error: message });
    }

    /** Shorthand: 401 Unauthorized. */
    unauthorized(message = "Unauthorized"): void {
        this.send(401, { error: message });
    }

    /** Shorthand: 403 Forbidden. */
    forbidden(message = "Forbidden"): void {
        this.send(403, { error: message });
    }

    /** Shorthand: 404 Not Found. */
    notFound(message = "Not Found"): void {
        this.send(404, { error: message });
    }

    get method(): HttpMethod {
        return this.req.method;
    }
    get pathname(): string {
        return this.req.pathname;
    }
}
