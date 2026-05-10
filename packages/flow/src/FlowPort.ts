import type { FlowComponent } from './FlowComponent.js';
import type { FlowTransport } from './FlowTransport.js';
import type { PortDirection } from './types.js';


export class FlowPort<T> {
    readonly name: string;
    readonly direction: PortDirection;
    readonly owner: FlowComponent;

    private readonly _queue: T[] = [];
    private readonly _transports: FlowTransport<T>[] = [];

    constructor(name: string, direction: PortDirection, owner: FlowComponent) {
        this.name = name;
        this.direction = direction;
        this.owner = owner;
    }

    get size(): number {
        return this._queue.length;
    }

    peek(): T | undefined {
        return this._queue[0];
    }

    read(): T | undefined {
        return this._queue.shift();
    }

    put(msg: T): void {
        this._queue.push(msg);
        if (this.direction === 'in') {
            this.owner.context.scheduler?.enqueue(this.owner);
        } else {
            for (const transport of this._transports) {
                transport.deliver(msg);
            }
        }
    }

    _addTransport(transport: FlowTransport<T>): void {
        this._transports.push(transport);
    }
}
