import { FlowComponent, type FlowComponentOptions } from "../../FlowComponent.js";
import type { FlowPort } from "../../FlowPort.js";
import { encodeBody, mergeEncodedHeaders } from "./codec.js";
import type {
    HttpRequest,
    HttpRequestDraft,
    HttpResponse,
    HttpResponseDraft,
} from "./HttpTypes.js";

/**
 * Serialises the body of draft HTTP messages to wire format (string | Uint8Array)
 * and sets the appropriate Content-Type header.
 *
 * Supported content types (inferred from body when not explicit):
 *   JS object/array → application/json
 *   string          → text/plain; charset=utf-8
 *   Uint8Array      → application/octet-stream
 *   object + explicit 'application/x-www-form-urlencoded' → form encoding
 */
export class HttpEncoder extends FlowComponent {
    readonly requestIn: FlowPort<HttpRequestDraft>;
    readonly requestOut: FlowPort<HttpRequest>;
    readonly responseIn: FlowPort<HttpResponseDraft>;
    readonly responseOut: FlowPort<HttpResponse>;

    constructor(options: FlowComponentOptions) {
        super(options);
        this.requestIn = this.addPort<HttpRequestDraft>("requestIn", "in");
        this.requestOut = this.addPort<HttpRequest>("requestOut", "out");
        this.responseIn = this.addPort<HttpResponseDraft>("responseIn", "in");
        this.responseOut = this.addPort<HttpResponse>("responseOut", "out");
    }

    override step(): void {
        let req: HttpRequestDraft | undefined;
        while ((req = this.requestIn.read()) !== undefined) {
            const { body, contentTypeHeader } = encodeBody(req.body, req.contentType);
            this.requestOut.put({
                requestId: req.requestId,
                method: req.method ?? "GET",
                url: req.url,
                headers: mergeEncodedHeaders(req.headers, contentTypeHeader),
                body,
            });
        }

        let resp: HttpResponseDraft | undefined;
        while ((resp = this.responseIn.read()) !== undefined) {
            const { body, contentTypeHeader } = encodeBody(resp.body, resp.contentType);
            this.responseOut.put({
                requestId: resp.requestId,
                status: resp.status ?? 200,
                statusText: resp.statusText,
                headers: mergeEncodedHeaders(resp.headers, contentTypeHeader),
                body,
            });
        }
    }
}
