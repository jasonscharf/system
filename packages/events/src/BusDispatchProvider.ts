import type { ISystemBus } from "@jasonscharf/core";
import type { DataExec, DispatchProvider, VoidExec } from "./DispatchProvider.js";
import { dispatchIri } from "./iri.js";
import type {
    ArgOf,
    CommandRegistry,
    EventRegistry,
    NameOf,
    OperationRegistry,
    OperationResultRegistry,
    QueryRegistry,
    QueryResultRegistry,
    ResultOf,
} from "./registry.js";

// ── BusDispatchProvider ──────────────────────────────────────────────────────────
//
// The client-side (and server-side caller) DispatchProvider.  It carries every
// kind over an ISystemBus, which round-trips a reply for command/query/operation
// — so the awaited exec() resolves on completion or throws the propagated Error,
// even across a queue and even for void-returning kinds.
//
// The SAME implementation works in-process (InMemorySystemBus) and across a
// queue (RedisSystemBus); only the injected bus differs.

/** A wrapper that resolves to void once the bus RPC completes. */
function _voidHandle(bus: ISystemBus, iri: string): VoidExec<unknown> {
    return {
        async exec(arg: unknown): Promise<void> {
            await bus.command(iri, arg ?? null);
        },
    };
}

/** A wrapper that resolves to the typed data set once the bus RPC completes. */
function _dataHandle(
    bus: ISystemBus,
    iri: string,
    rpcKind: "query" | "operation",
): DataExec<unknown, unknown> {
    return {
        async exec(arg: unknown): Promise<unknown> {
            if (rpcKind === "query") {
                return bus.query(iri, arg ?? null);
            }
            return bus.operation(iri, arg ?? null);
        },
    };
}

export class BusDispatchProvider implements DispatchProvider {
    private readonly _bus: ISystemBus;

    constructor(bus: ISystemBus) {
        this._bus = bus;
    }

    command<N extends NameOf<CommandRegistry>>(name: N): VoidExec<ArgOf<CommandRegistry, N>> {
        return _voidHandle(this._bus, dispatchIri("command", name)) as VoidExec<
            ArgOf<CommandRegistry, N>
        >;
    }

    event<N extends NameOf<EventRegistry>>(name: N): VoidExec<ArgOf<EventRegistry, N>> {
        // Events ride the command RPC verb but keep an event-namespaced IRI, so
        // they get the same completion/error round-trip (never fire-and-forget).
        return _voidHandle(this._bus, dispatchIri("event", name)) as VoidExec<
            ArgOf<EventRegistry, N>
        >;
    }

    query<N extends NameOf<QueryRegistry>>(
        name: N,
    ): DataExec<ArgOf<QueryRegistry, N>, ResultOf<QueryResultRegistry, N>> {
        return _dataHandle(this._bus, dispatchIri("query", name), "query") as DataExec<
            ArgOf<QueryRegistry, N>,
            ResultOf<QueryResultRegistry, N>
        >;
    }

    operation<N extends NameOf<OperationRegistry>>(
        name: N,
    ): DataExec<ArgOf<OperationRegistry, N>, ResultOf<OperationResultRegistry, N>> {
        return _dataHandle(this._bus, dispatchIri("operation", name), "operation") as DataExec<
            ArgOf<OperationRegistry, N>,
            ResultOf<OperationResultRegistry, N>
        >;
    }
}
