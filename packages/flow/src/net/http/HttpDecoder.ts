import { FlowComponent, type FlowComponentOptions } from "../../FlowComponent.js";
import type { FlowPort } from "../../FlowPort.js";
import { decodeBody, extractContentType } from "./codec.js";
import type {
    HttpRequest,
    HttpResponse,
    ParsedHttpRequest,
    ParsedHttpResponse,
} from "./HttpTypes.js";

const BASE = "http://localhost";

function parseUrl(raw: string): { pathname: string; searchParams: URLSearchParams } {
    try {
        const u = new URL(raw, BASE);
        return { pathname: u.pathname, searchParams: u.searchParams };
    } catch {
        return { pathname: raw, searchParams: new URLSearchParams() };
    }
}

/**
 * Deserialises the body of raw HTTP messages based on Content-Type and
 * enriches requests with parsed URL components.
 *
 * Supported content types:
 *   application/json                  → JS object
 *   application/x-www-form-urlencoded → Record<string, string>
 *   text/*                            → string
 *   other                             → raw (string | Uint8Array)
 */
export class HttpDecoder extends FlowComponent {
    readonly requestIn: FlowPort<HttpRequest>;
    readonly requestOut: FlowPort<ParsedHttpRequest>;
    readonly responseIn: FlowPort<HttpResponse>;
    readonly responseOut: FlowPort<ParsedHttpResponse>;

    constructor(options: FlowComponentOptions) {
        super(options);
        this.requestIn = this.addPort<HttpRequest>("requestIn", "in");
        this.requestOut = this.addPort<ParsedHttpRequest>("requestOut", "out");
        this.responseIn = this.addPort<HttpResponse>("responseIn", "in");
        this.responseOut = this.addPort<ParsedHttpResponse>("responseOut", "out");
    }

    override step(): void {
        for (;;) {
            const req = this.requestIn.read();
            if (req === undefined) {
                break;
            }
            const ct = extractContentType(req.headers);
            const { pathname, searchParams } = parseUrl(req.url);
            this.requestOut.put({
                requestId: req.requestId,
                method: req.method,
                url: req.url,
                pathname,
                searchParams,
                headers: req.headers,
                body: decodeBody(req.body, ct),
                contentType: ct || undefined,
            });
        }

        for (;;) {
            const resp = this.responseIn.read();
            if (resp === undefined) {
                break;
            }
            const ct = extractContentType(resp.headers);
            this.responseOut.put({
                requestId: resp.requestId,
                status: resp.status,
                statusText: resp.statusText,
                ok: resp.status >= 200 && resp.status < 300,
                headers: resp.headers,
                body: decodeBody(resp.body, ct),
                contentType: ct || undefined,
            });
        }
    }
}
