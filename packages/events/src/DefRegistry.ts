import type {
    CommandDef,
    DispatchDef,
    DispatchKind,
    EventDef,
    OperationDef,
    QueryDef,
} from "./types.js";

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

    /** Remove every registered definition.  Intended for test isolation. */
    clear(): void {
        this._defs.clear();
    }
}
