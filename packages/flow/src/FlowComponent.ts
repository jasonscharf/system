import { IRI, literal, makeUri, NS_ROOT, type Quad, quad, uuidv4Binary } from "@jasonscharf/core";
import { Control, type ControlSignal } from "./ControlSignal.js";
import type { FlowContext } from "./FlowContext.js";
import type { FlowNode } from "./FlowNode.js";
import { FlowPort } from "./FlowPort.js";
import type { ComponentState, ID, IDisposable, PortDirection, ReadMode } from "./types.js";

// RDF namespace for flow entities
const FLOW_NS = makeUri(NS_ROOT, "flow");
const XSD_NS = "http://www.w3.org/2001/XMLSchema#";

const RDF_TYPE = new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const XSD_STRING = new IRI(`${XSD_NS}string`);
const FLOW_COMPONENT = new IRI(makeUri(FLOW_NS, "Component"));
const FLOW_NAME = new IRI(makeUri(FLOW_NS, "name"));
const FLOW_STATE = new IRI(makeUri(FLOW_NS, "state"));
const FLOW_PORT_PRED = new IRI(makeUri(FLOW_NS, "port"));
const FLOW_PORT_TYPE = new IRI(makeUri(FLOW_NS, "Port"));
const FLOW_PORT_NAME = new IRI(makeUri(FLOW_NS, "portName"));
const FLOW_DIRECTION = new IRI(makeUri(FLOW_NS, "direction"));
const FLOW_DEFAULT_GRAPH = new IRI(makeUri(FLOW_NS, "graph"));

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

    /**
     * Inbound control port. Put a ControlSignal here to start, stop, pause,
     * or resume this component. The base class step() drains this port before
     * processing any data ports, so control signals always take priority.
     */
    readonly inControl: FlowPort<ControlSignal>;

    private readonly _ports = new Map<string, FlowPort<unknown>>();
    private readonly _children: FlowComponent[] = [];
    private readonly _disposables: IDisposable[] = [];
    private _state: ComponentState = "idle";
    private _controlState: "running" | "paused" | "stopped" = "running";
    private _inFlightTasks = 0;

    /**
     * Controls how the base class step() reads from data ports when using on()
     * handlers. "once" (default) reads one message per port per step. "drain"
     * reads all pending messages in a single step.
     */
    protected _readMode: ReadMode = "once";

    constructor(options: FlowComponentOptions) {
        this.id = options.id ?? uuidv4Binary();
        this.iri = options.iri;
        this.name = options.name ?? "";
        this.context = options.context;
        this.inControl = this.addPort<ControlSignal>("inControl", "in");
    }

    /** True while no stop or pause signal has been received. */
    get isRunning(): boolean {
        return this._controlState === "running";
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

    /**
     * Number of detached async tasks (registered via trackInFlight) that have
     * not yet settled, including those of children. FlowApp.stop() drains
     * until every component reports zero before disposing anything.
     */
    get inFlight(): number {
        let count = this._inFlightTasks;
        for (const child of this._children) {
            count += child.inFlight;
        }
        return count;
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

    /**
     * Register a handler for messages on a data port. The handler is called by
     * the base class step() according to _readMode (once or drain).
     *
     * Do not register handlers on inControl — override onControl() instead.
     */
    on<T>(port: FlowPort<T>, handler: (msg: T) => void): void {
        port.on(handler);
    }

    // ── Lifecycle control ─────────────────────────────────────────────────────
    // Convenience wrappers that put a ControlSignal on inControl. The scheduler
    // will drain inControl on the next step(), update isRunning, and call
    // onControl(). These methods are available on every component.

    start(): void {
        this.inControl.put(Control.start());
    }

    stop(): void {
        this.inControl.put(Control.stop());
    }

    pause(): void {
        this.inControl.put(Control.pause());
    }

    resume(wasStopped = false, since = Date.now()): void {
        this.inControl.put(Control.resume(wasStopped, since));
    }

    // ── Lifecycle hooks ───────────────────────────────────────────────────────
    // Override these in subclasses to react to control signals. The base class
    // handles state transitions before calling each hook.

    protected onStart(): void {}
    protected onStop(): void {}
    protected onPause(): void {}
    protected onResume(_wasStopped: boolean, _since: number): void {}

    step(): void | Promise<void> {
        // 1. Drain all pending control signals — priority over data.
        //    The queue is finite (bounded by puts to inControl), so this terminates.
        while (this.inControl.size > 0) {
            const signal = this.inControl.read();
            if (signal === undefined) {
                break;
            }
            switch (signal.type) {
                case "start":
                    this._controlState = "running";
                    this.onStart();
                    this._reactivate();
                    break;
                case "stop":
                    this._controlState = "stopped";
                    this.onStop();
                    break;
                case "pause":
                    this._controlState = "paused";
                    this.onPause();
                    break;
                case "resume":
                    this._controlState = "running";
                    this.onResume(signal.wasStopped, signal.since);
                    this._reactivate();
                    break;
            }
        }
        // 2. Skip data processing when paused or stopped.
        if (!this.isRunning) {
            return;
        }
        // 3. Dispatch data ports via on() handlers.
        for (const [, port] of this._ports) {
            if (port.direction === "in" && port !== (this.inControl as FlowPort<unknown>)) {
                port.dispatch(this._readMode);
            }
        }
    }

    // Enqueue self once per pending data message so the scheduler calls step()
    // the right number of times after a start or resume restores isRunning.
    private _reactivate(): void {
        for (const [, port] of this._ports) {
            if (port.direction === "in" && port !== (this.inControl as FlowPort<unknown>)) {
                for (let i = 0; i < port.size; i++) {
                    this.context.scheduler?.enqueue(this);
                }
            }
        }
    }

    protected onInit(): void | Promise<void> {}

    /**
     * Stop taking on NEW work (a source stops pulling; a poller stops its
     * timer) while keeping resources open so already-accepted work can finish
     * and its feedback (e.g. a broker ack) can still be processed. Called by
     * FlowApp.stop() on every component before the shutdown drain. Must be
     * safe to call more than once. Default: no-op.
     */
    protected onQuiesce(): void | Promise<void> {}

    protected onDispose(): void | Promise<void> {}

    /**
     * Register a detached async task spawned by step() as in-flight work.
     * FlowApp.stop() drains until every tracked task has settled before
     * disposing, so work like a send-whose-ack-must-commit is never cut off
     * mid-flight. Error handling stays with the caller (attach catch before
     * tracking); tracking only observes settlement.
     */
    protected trackInFlight(task: Promise<unknown>): void {
        this._inFlightTasks += 1;
        const settle = (): void => {
            this._inFlightTasks -= 1;
        };
        task.then(settle, settle);
    }

    async init(): Promise<void> {
        await this.onInit();
        for (const child of this._children) {
            await child.init();
        }
        this._state = "running";
    }

    async quiesce(): Promise<void> {
        await this.onQuiesce();
        for (const child of this._children) {
            await child.quiesce();
        }
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

        const subject = this.iri ?? new IRI(makeUri(FLOW_NS, "component", idHex));
        const graph = FLOW_DEFAULT_GRAPH;

        const quads: Quad[] = [
            quad(subject, RDF_TYPE, FLOW_COMPONENT, graph),
            quad(subject, FLOW_NAME, literal(this.name, XSD_STRING), graph),
            quad(subject, FLOW_STATE, literal(this._state, XSD_STRING), graph),
        ];

        for (const [, port] of this._ports) {
            const portIRI = new IRI(makeUri(FLOW_NS, "port", idHex, port.name));
            quads.push(quad(subject, FLOW_PORT_PRED, portIRI, graph));
            quads.push(quad(portIRI, RDF_TYPE, FLOW_PORT_TYPE, graph));
            quads.push(quad(portIRI, FLOW_PORT_NAME, literal(port.name, XSD_STRING), graph));
            quads.push(quad(portIRI, FLOW_DIRECTION, literal(port.direction, XSD_STRING), graph));
        }

        return quads;
    }
}
