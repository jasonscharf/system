import { IRI, literal, type Quad, quad, uuidv4Binary } from "@jasonscharf/core";
import type { FlowContext } from "./FlowContext.js";
import type { FlowNode } from "./FlowNode.js";
import { FlowPort } from "./FlowPort.js";
import type { ComponentState, ID, IDisposable, PortDirection } from "./types.js";

// RDF namespace for flow entities
const FLOW_NS = "http://tern.dev/ns/flow/";
const XSD_NS = "http://www.w3.org/2001/XMLSchema#";

const RDF_TYPE = new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const XSD_STRING = new IRI(`${XSD_NS}string`);
const FLOW_COMPONENT = new IRI(`${FLOW_NS}Component`);
const FLOW_NAME = new IRI(`${FLOW_NS}name`);
const FLOW_STATE = new IRI(`${FLOW_NS}state`);
const FLOW_PORT_PRED = new IRI(`${FLOW_NS}port`);
const FLOW_PORT_TYPE = new IRI(`${FLOW_NS}Port`);
const FLOW_PORT_NAME = new IRI(`${FLOW_NS}portName`);
const FLOW_DIRECTION = new IRI(`${FLOW_NS}direction`);
const FLOW_DEFAULT_GRAPH = new IRI(`${FLOW_NS}graph`);

export interface FlowComponentOptions {
    name?: string;
    id?: ID;
    iri?: IRI;
    context: FlowContext;
}

export class FlowComponent implements FlowNode {
    readonly id: ID;
    readonly iri?: IRI;
    readonly name: string;
    readonly context: FlowContext;

    private readonly _ports = new Map<string, FlowPort<unknown>>();
    private readonly _children: FlowComponent[] = [];
    private readonly _disposables: IDisposable[] = [];
    private readonly _handlers = new Map<FlowPort<unknown>, Array<(msg: unknown) => void>>();
    private _state: ComponentState = "idle";

    constructor(options: FlowComponentOptions) {
        this.id = options.id ?? uuidv4Binary();
        this.iri = options.iri;
        this.name = options.name ?? "";
        this.context = options.context;
    }

    get state(): ComponentState {
        return this._state;
    }

    get ports(): ReadonlyMap<string, FlowPort<unknown>> {
        return this._ports;
    }

    get children(): readonly FlowComponent[] {
        return this._children;
    }

    protected addPort<T>(name: string, direction: PortDirection): FlowPort<T> {
        const port = new FlowPort<T>(name, direction, this);
        this._ports.set(name, port as FlowPort<unknown>);
        return port;
    }

    addChild(child: FlowComponent): void {
        this._children.push(child);
    }

    addDisposable(disposable: IDisposable): void {
        this._disposables.push(disposable);
    }

    on<T>(port: FlowPort<T>, handler: (msg: T) => void): void {
        const existing = this._handlers.get(port as FlowPort<unknown>) ?? [];
        existing.push(handler as (msg: unknown) => void);
        this._handlers.set(port as FlowPort<unknown>, existing);
    }

    step(): void {
        for (const [port, handlers] of this._handlers) {
            for (;;) {
                const msg = port.read();
                if (msg === undefined) {
                    break;
                }
                for (const h of handlers) {
                    h(msg);
                }
            }
        }
    }

    protected onInit(): void | Promise<void> {}

    protected onDispose(): void | Promise<void> {}

    async init(): Promise<void> {
        await this.onInit();
        for (const child of this._children) {
            await child.init();
        }
        this._state = "running";
    }

    async dispose(): Promise<void> {
        this._state = "disposed";
        for (const child of [...this._children].reverse()) {
            await child.dispose();
        }
        for (const d of [...this._disposables].reverse()) {
            await d.dispose();
        }
        await this.onDispose();
    }

    toQuads(): Quad[] {
        const idHex =
            this.id instanceof Uint8Array
                ? Array.from(this.id)
                      .map((b) => b.toString(16).padStart(2, "0"))
                      .join("")
                : this.id.toString(16);

        const subject = this.iri ?? new IRI(`${FLOW_NS}component/${idHex}`);
        const graph = FLOW_DEFAULT_GRAPH;

        const quads: Quad[] = [
            quad(subject, RDF_TYPE, FLOW_COMPONENT, graph),
            quad(subject, FLOW_NAME, literal(this.name, XSD_STRING), graph),
            quad(subject, FLOW_STATE, literal(this._state, XSD_STRING), graph),
        ];

        for (const [, port] of this._ports) {
            const portIRI = new IRI(`${FLOW_NS}port/${idHex}/${port.name}`);
            quads.push(quad(subject, FLOW_PORT_PRED, portIRI, graph));
            quads.push(quad(portIRI, RDF_TYPE, FLOW_PORT_TYPE, graph));
            quads.push(quad(portIRI, FLOW_PORT_NAME, literal(port.name, XSD_STRING), graph));
            quads.push(quad(portIRI, FLOW_DIRECTION, literal(port.direction, XSD_STRING), graph));
        }

        return quads;
    }
}
