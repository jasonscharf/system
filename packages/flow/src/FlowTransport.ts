import type { FlowPort } from './FlowPort.js';


export abstract class FlowTransport<T> {
    readonly from: FlowPort<T>;
    readonly to: FlowPort<T>;

    constructor(from: FlowPort<T>, to: FlowPort<T>) {
        this.from = from;
        this.to = to;
    }

    abstract deliver(msg: T): void;
}

export class LocalTransport<T> extends FlowTransport<T> {
    deliver(msg: T): void {
        this.to.put(msg);
    }
}
