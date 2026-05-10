import { FlowComponent, type FlowComponentOptions } from '../../FlowComponent.js';
import { FlowPort } from '../../FlowPort.js';
import type { HttpRequest } from './HttpTypes.js';


/**
 * Feeds raw HttpRequests into the flow graph on behalf of HttpServer.
 * The parent calls _inject() from its http.IncomingMessage event handler.
 */
export class HttpRequestReader extends FlowComponent {
    readonly out: FlowPort<HttpRequest>;

    constructor(options: FlowComponentOptions) {
        super(options);
        this.out = this.addPort<HttpRequest>('out', 'out');
    }

    _inject(request: HttpRequest): void {
        this.out.put(request);
    }

    override step(): void {
        // Driven by _inject(); the http module pushes data in.
    }
}
