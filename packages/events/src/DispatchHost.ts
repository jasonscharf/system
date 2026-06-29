import type { ISystemBus } from "@jasonscharf/core";
import type { DefRegistry } from "./DefRegistry.js";
import { dispatchIri, rpcKindFor } from "./iri.js";
import { Runner, type RunnerOptions } from "./runner.js";
import type { DispatchKind } from "./types.js";

// ── DispatchHost ─────────────────────────────────────────────────────────────────
//
// The server side of dispatch.  It binds each registered definition to an
// ISystemBus RPC handler, so requests arriving over the bus (in-process or
// across a queue) run the definition's invocation sequence (and reducers) via
// the Runner and reply with the result — or with the Error if any invocation
// throws.  Because the bus round-trips a reply, the caller's awaited exec()
// always resolves or throws; events get the same treatment as commands.
//
// A host is itself NOT a DispatchProvider — callers use a BusDispatchProvider
// over the same bus.  Keeping the two roles separate mirrors the client/server
// split the ticket calls for.

export interface DispatchHostOptions extends RunnerOptions {}

export class DispatchHost {
    private readonly _bus: ISystemBus;
    private readonly _registry: DefRegistry;
    private readonly _runner: Runner;
    private readonly _bound = new Set<string>();

    constructor(bus: ISystemBus, registry: DefRegistry, options: DispatchHostOptions = {}) {
        this._bus = bus;
        this._registry = registry;
        this._runner = new Runner(registry, options);
    }

    /**
     * Bind a single (kind, name) definition to the bus.  Idempotent per
     * (kind, name).  Throws if no matching definition is registered.  Await
     * before sending the first matching request so the handler is ready.
     */
    async bind(kind: DispatchKind, name: string): Promise<void> {
        if (!this._registry.has(kind, name)) {
            throw new Error(`No ${kind} definition registered for "${name}"`);
        }
        const iri = dispatchIri(kind, name);
        if (this._bound.has(iri)) {
            return;
        }
        this._bound.add(iri);
        await this._bus.handle(iri, rpcKindFor(kind), async (payload: unknown) => {
            return this._runner.run(kind, name, payload);
        });
    }
}
