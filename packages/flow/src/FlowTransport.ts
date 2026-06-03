import type { FlowPort } from "./FlowPort.js";

export abstract class FlowTransport<T> {
    // Set by FlowApp.connect() (or wire()) before first use.
    from!: FlowPort<T>;
    // Undefined for sink transports (e.g. RedisTransport) that write to an
    // external system rather than a local inbound port.
    to?: FlowPort<T>;

    /**
     * Called by FlowApp.connect() to bind the ports this transport bridges.
     * For sink transports (app.connect(out, transport)), `to` is omitted.
     */
    _attach(from: FlowPort<T>, to?: FlowPort<T>): void {
        this.from = from;
        this.to = to;
    }

    abstract deliver(msg: T): void;
}

/** In-process synchronous transport. Default when no transport is supplied. */
export class LocalTransport<T> extends FlowTransport<T> {
    deliver(msg: T): void {
        if (!this.to) {
            throw new Error(
                "LocalTransport requires a destination port — use a sink transport for external delivery",
            );
        }
        this.to.put(msg);
    }
}

/**
 * Low-level helper for wiring ports without a FlowApp. Attaches a transport,
 * links it to the source port, and returns it.
 *
 * Two forms:
 *   wire(outPort, inPort)             — LocalTransport by default
 *   wire(outPort, inPort, transport)  — custom transport (full connection)
 *   wire(outPort, transport)          — custom sink transport (no local inPort)
 *
 * Prefer app.connect() for managed graphs.
 */
export function wire<T>(
    from: FlowPort<T>,
    to: FlowPort<T> | FlowTransport<T>,
    transport?: FlowTransport<T>,
): FlowTransport<T> {
    if (to instanceof FlowTransport) {
        to._attach(from, undefined);
        from.addTransport(to);
        return to;
    }
    const t = transport ?? new LocalTransport<T>();
    t._attach(from, to);
    from.addTransport(t);
    return t;
}
