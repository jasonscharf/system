import type {
    CommandDef,
    DispatchDef,
    DispatchKind,
    DispatchManifestEntry,
    EventDef,
    OperationDef,
    QueryDef,
} from "./types.js";

// Deterministic kind ordering for describe() — independent of insertion order.
const _KIND_ORDER: Record<DispatchKind, number> = {
    command: 0,
    event: 1,
    query: 2,
    operation: 3,
};

// ── Definition registry ──────────────────────────────────────────────────────────
//
// The in-memory source of dispatch definitions.  Eventually these are sourced
// from composed app/extension config (RDF/YAML).
//
// TODO(TRN-232): source from composed config (config-composition model).  Until
// that lands, definitions are registered explicitly via this API and the
// resolver consumes from here.

function _key(kind: DispatchKind, name: string): string {
    return `${kind}::${name}`;
}

/**
 * Holds dispatch definitions keyed by (kind, name).  A definition declares the
 * ordered async invocation sequence (and, for query/operation, the reducers)
 * to run when a named entry is dispatched.
 */
export class DefRegistry {
    private readonly _defs = new Map<string, DispatchDef>();

    /** Register a command definition under its name. */
    registerCommand(name: string, def: Omit<CommandDef, "name" | "kind">): void {
        this._defs.set(_key("command", name), { ...def, name, kind: "command" });
    }

    /** Register an event definition under its name. */
    registerEvent(name: string, def: Omit<EventDef, "name" | "kind">): void {
        this._defs.set(_key("event", name), { ...def, name, kind: "event" });
    }

    /** Register a query definition under its name. */
    registerQuery(name: string, def: Omit<QueryDef, "name" | "kind">): void {
        this._defs.set(_key("query", name), { ...def, name, kind: "query" });
    }

    /** Register an operation definition under its name. */
    registerOperation(name: string, def: Omit<OperationDef, "name" | "kind">): void {
        this._defs.set(_key("operation", name), { ...def, name, kind: "operation" });
    }

    /** Look up a definition by kind and name, or null when absent. */
    get(kind: DispatchKind, name: string): DispatchDef | null {
        return this._defs.get(_key(kind, name)) ?? null;
    }

    /** True when a definition exists for the given kind and name. */
    has(kind: DispatchKind, name: string): boolean {
        return this._defs.has(_key(kind, name));
    }

    /**
     * Project every registered definition into the runtime dispatch manifest:
     * the public, JSON-serializable catalog a generic client (CLI, WebSockets,
     * Switchyard) consumes to discover the dispatch surface.  Server-internal
     * wiring (module-refs, reducers) is intentionally omitted; only the public
     * contract (kind, name, optional documentation) is surfaced.
     *
     * Sorted deterministically by kind (command, event, query, operation) then
     * name, so the output is stable across runs and registration order.
     */
    describe(): DispatchManifestEntry[] {
        const entries: DispatchManifestEntry[] = [];
        for (const def of this._defs.values()) {
            const entry: DispatchManifestEntry = {
                kind: def.kind,
                name: def.name,
            };
            if (def.description != null) {
                (entry as { description?: string }).description = def.description;
            }
            if (def.argSchema != null) {
                (entry as { argSchema?: unknown }).argSchema = def.argSchema;
            }
            if ((def.kind === "query" || def.kind === "operation") && def.resultSchema != null) {
                (entry as { resultSchema?: unknown }).resultSchema = def.resultSchema;
            }
            entries.push(entry);
        }
        entries.sort((a, b) => {
            const byKind = _KIND_ORDER[a.kind] - _KIND_ORDER[b.kind];
            if (byKind !== 0) {
                return byKind;
            }
            return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
        });
        return entries;
    }

    /** Remove every registered definition.  Intended for test isolation. */
    clear(): void {
        this._defs.clear();
    }
}
