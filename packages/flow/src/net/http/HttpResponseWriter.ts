import { FlowComponent, type FlowComponentOptions } from "../../FlowComponent.js";
import type { FlowPort } from "../../FlowPort.js";
import type { HttpHeaders, HttpResponse } from "./HttpTypes.js";

export type HttpResponseSendFn = (response: HttpResponse) => void;

/**
 * Baseline security headers applied to every outgoing response unless the
 * response already sets the same header (per-response override wins). These are
 * intentionally conservative and framework-agnostic; richer policies (CSP, HSTS)
 * are left to the application layer where context is available.
 */
export const DEFAULT_SECURITY_HEADERS: HttpHeaders = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
};

export interface HttpResponseWriterOptions extends FlowComponentOptions {
    /**
     * Default security headers merged onto every response. A header already
     * present on the response itself takes precedence (case-insensitive). Pass
     * an empty object to disable. Defaults to {@link DEFAULT_SECURITY_HEADERS}.
     */
    securityHeaders?: HttpHeaders;
}

/**
 * Reads HttpResponse datagrams from its input port and dispatches them to the
 * matching pending ServerResponse via the function injected by HttpServer.
 *
 * Applies a baseline set of security headers to each response unless the
 * response already specifies the same header (case-insensitive).
 */
export class HttpResponseWriter extends FlowComponent {
    readonly in: FlowPort<HttpResponse>;
    private readonly _securityHeaders: HttpHeaders;
    private _send?: HttpResponseSendFn;

    constructor(options: HttpResponseWriterOptions) {
        super(options);
        this.in = this.addPort<HttpResponse>("in", "in");
        this._securityHeaders = options.securityHeaders ?? DEFAULT_SECURITY_HEADERS;
    }

    _setSend(fn: HttpResponseSendFn): void {
        this._send = fn;
    }

    override step(): void {
        for (;;) {
            const resp = this.in.read();
            if (resp === undefined) {
                break;
            }
            this._send?.(this._applySecurityHeaders(resp));
        }
    }

    private _applySecurityHeaders(response: HttpResponse): HttpResponse {
        const existing = response.headers ?? {};
        const present = new Set(Object.keys(existing).map((k) => k.toLowerCase()));
        const merged: HttpHeaders = { ...existing };
        for (const [key, value] of Object.entries(this._securityHeaders)) {
            if (!present.has(key.toLowerCase())) {
                merged[key] = value;
            }
        }
        return { ...response, headers: merged };
    }
}
