import { FlowComponent, type FlowComponentOptions } from '../../FlowComponent.js';
import { FlowPort } from '../../FlowPort.js';
import type { HttpResponse } from './HttpTypes.js';


export type HttpResponseSendFn = (response: HttpResponse) => void;

/**
 * Reads HttpResponse datagrams from its input port and dispatches them to the
 * matching pending ServerResponse via the function injected by HttpServer.
 */
export class HttpResponseWriter extends FlowComponent {
    readonly in: FlowPort<HttpResponse>;
    private _send?: HttpResponseSendFn;

    constructor(options: FlowComponentOptions) {
        super(options);
        this.in = this.addPort<HttpResponse>('in', 'in');
    }

    _setSend(fn: HttpResponseSendFn): void {
        this._send = fn;
    }

    override step(): void {
        let resp: HttpResponse | undefined;
        while ((resp = this.in.read()) !== undefined) {
            this._send?.(resp);
        }
    }
}
