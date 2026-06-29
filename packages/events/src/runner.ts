import { resolveModuleRef } from "@jasonscharf/core";
import type { DefRegistry } from "./DefRegistry.js";
import type {
    DispatchDef,
    DispatchKind,
    Invocation,
    InvocationCtx,
    Reducer,
    ReducerCtx,
} from "./types.js";

// ── Runner ────────────────────────────────────────────────────────────────────
//
// Executes a dispatch definition: resolves each module-ref via the system
// resolver, runs the invocation sequence in order (async), then, for queries
// and operations, folds the collected results through the reducer pipeline.
//
// Semantics enforced here:
//   command / event  -> always resolve to `undefined` (void).  Data is never
//                       returned even if an invocation produced a value.
//   query / operation -> resolve to the reduced data set.

export interface RunnerOptions {
    /** Base directory for resolving relative module-ref specifiers. */
    readonly baseDir?: string;
}

export class Runner {
    private readonly _registry: DefRegistry;
    private readonly _baseDir: string;

    constructor(registry: DefRegistry, options: RunnerOptions = {}) {
        this._registry = registry;
        this._baseDir = options.baseDir ?? process.cwd();
    }

    /**
     * Run the named definition with its single JSON arg.  Throws if no
     * definition is registered for (kind, name), or if any invocation throws.
     */
    async run(kind: DispatchKind, name: string, arg: unknown): Promise<unknown> {
        const def = this._registry.get(kind, name);
        if (def == null) {
            throw new Error(`No ${kind} definition registered for "${name}"`);
        }

        const results: unknown[] = [];
        const ctx: InvocationCtx = { name, kind, arg, results };

        for (const ref of def.invocations) {
            const value = await this._invoke(ref, ctx);
            if (value !== undefined && value !== null) {
                results.push(value);
            }
        }

        // command / event never return data, regardless of what ran.
        if (kind === "command" || kind === "event") {
            return undefined;
        }

        return this._reduce(def, ctx, results);
    }

    private async _invoke(ref: string, ctx: InvocationCtx): Promise<unknown> {
        const resolved = await resolveModuleRef(ref, this._baseDir);
        const fn = resolved.fn as Invocation;
        return fn(ctx);
    }

    private async _reduce(
        def: DispatchDef,
        ctx: InvocationCtx,
        results: unknown[],
    ): Promise<unknown> {
        const reducers = "reducers" in def ? def.reducers : [];
        // The accumulator starts as the collected results array.  With no
        // reducers, the data set IS that array.
        let acc: unknown = results;
        for (const ref of reducers) {
            const resolved = await resolveModuleRef(ref, this._baseDir);
            const fn = resolved.fn as Reducer;
            const reducerCtx: ReducerCtx = { ...ctx, acc };
            acc = await fn(reducerCtx);
        }
        return acc;
    }
}
