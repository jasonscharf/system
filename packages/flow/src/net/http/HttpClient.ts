import { getLogger } from "@jasonscharf/core";
import { FlowComponent, type FlowComponentOptions } from "../../FlowComponent.js";
import type { FlowPort } from "../../FlowPort.js";
import type { HttpHeaders, HttpRequest, HttpResponse } from "./HttpTypes.js";

const log = getLogger("HttpClient");

/**
 * Flow component that makes HTTP requests via the platform-native Fetch API
 * (globalThis.fetch — Node.js 18+, all modern browsers).
 *
 * Requests are fired concurrently; responses are put on the responses port
 * asynchronously when each fetch resolves. All in-flight requests are aborted
 * when the component is disposed.
 *
 * Ports:
 *   requests   (in)  — HttpRequest to send
 *   responses  (out) — HttpResponse received (carries requestId if present)
 */
export class HttpClient extends FlowComponent {
    readonly requests: FlowPort<HttpRequest>;
    readonly responses: FlowPort<HttpResponse>;

    private _controller = new AbortController();

    constructor(options: FlowComponentOptions) {
        super(options);
        this.requests = this.addPort<HttpRequest>("requests", "in");
        this.responses = this.addPort<HttpResponse>("responses", "out");
    }

    protected override async onInit(): Promise<void> {
        if (typeof globalThis.fetch !== "function") {
            throw new Error(
                "HttpClient requires a platform-native fetch (Node.js ≥ 18, modern browsers). " +
                    "No globalThis.fetch found.",
            );
        }
    }

    protected override onDispose(): void {
        this._controller.abort();
        this._controller = new AbortController();
    }

    override step(): void {
        for (;;) {
            const req = this.requests.read();
            if (req === undefined) {
                break;
            }
            // Detached fetch: register as in-flight work so FlowApp.stop() drains
            // it before disposing (graceful-drain contract, TRN-472). _fetch never
            // rejects — a transport failure surfaces as an error response on the
            // responses port rather than an unhandled rejection (TRN-528).
            this.trackInFlight(this._fetch(req));
        }
    }

    private async _fetch(request: HttpRequest): Promise<void> {
        try {
            const body =
                request.method === "GET" || request.method === "HEAD"
                    ? undefined
                    : (request.body ?? undefined);

            const res = await globalThis.fetch(request.url, {
                method: request.method,
                headers: flattenForFetch(request.headers),
                body: body as BodyInit | undefined,
                signal: this._controller.signal,
            });

            const responseHeaders: HttpHeaders = {};
            res.headers.forEach((v, k) => {
                responseHeaders[k] = v;
            });

            this.responses.put({
                requestId: request.requestId,
                status: res.status,
                statusText: res.statusText,
                headers: responseHeaders,
                body: (await res.text()) || undefined,
            });
        } catch (err) {
            // A cancelled request (dispose aborts the controller) is expected —
            // swallow it silently and emit nothing.
            if ((err as Error).name === "AbortError") {
                return;
            }
            // Any other failure (DNS, connection refused, TLS, …) is a
            // transport-level error. Log it and surface it as an error response
            // (status 0, the fetch/XHR network-error convention) so the process
            // survives and downstream can react — never an unhandled rejection.
            const message = err instanceof Error ? err.message : String(err);
            log.error("HTTP request failed", {
                component: this.name,
                url: request.url,
                error: message,
            });
            this.responses.put({
                requestId: request.requestId,
                status: 0,
                statusText: message,
                headers: {},
                body: undefined,
            });
        }
    }
}

function flattenForFetch(headers: HttpHeaders): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
        out[k] = Array.isArray(v) ? v.join(", ") : v;
    }
    return out;
}
