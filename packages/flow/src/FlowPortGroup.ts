import type { FlowPort } from "./FlowPort.js";

type PortTuple = readonly FlowPort<unknown>[];

type UnwrapPorts<T extends PortTuple> = {
    [K in keyof T]: T[K] extends FlowPort<infer U> ? U : never;
};

/**
 * A group of ports that is only ready when every constituent port has at least
 * one message queued. `readAll()` atomically dequeues one message from each.
 *
 * This implements the classic FBP synchronisation / zip pattern — a component
 * can block until all its required inputs are simultaneously available.
 */
export class FlowPortGroup<T extends PortTuple> {
    constructor(private readonly _ports: T) {}

    get ready(): boolean {
        return this._ports.every((p) => p.size > 0);
    }

    readAll(): UnwrapPorts<T> | undefined {
        if (!this.ready) {
            return undefined;
        }
        return this._ports.map((p) => p.read()) as UnwrapPorts<T>;
    }
}
