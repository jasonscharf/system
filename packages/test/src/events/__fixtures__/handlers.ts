import type { InvocationCtx, ReducerCtx } from "@jasonscharf/events";

// Real fixture handlers used by the dispatch tests.  No mocks: these are
// ordinary exported async functions resolved through the module-ref loader and
// invoked by the Runner exactly as production handlers would be.
//
// Side-effect state is anchored on globalThis so that — regardless of how the
// test runner instantiates this module (a static import vs. the module-ref
// loader's file:// import can be distinct instances under vitest) — every copy
// reads and writes the SAME sink.  The observable signal for the void-returning
// command/event kinds is therefore stable across module identities.

interface DispatchFixtureState {
    sideEffects: string[];
    store: Record<string, number>;
}

const KEY = "__sysDispatchFixtureState__";

function state(): DispatchFixtureState {
    const g = globalThis as unknown as Record<string, DispatchFixtureState | undefined>;
    let s = g[KEY];
    if (s == null) {
        s = { sideEffects: [], store: {} };
        g[KEY] = s;
    }
    return s;
}

/** The recorded side effects (shared across module instances). */
export const sideEffects: string[] = state().sideEffects;

/** The in-memory mutation store (shared across module instances). */
export const store: Record<string, number> = state().store;

export function resetSideEffects(): void {
    state().sideEffects.length = 0;
}

export function resetStore(): void {
    const s = state().store;
    for (const k of Object.keys(s)) {
        delete s[k];
    }
}

// ── Command / event invocations (void) ───────────────────────────────────────────

/** First step of a command sequence: records that it ran with its arg. */
export async function recordActivate(ctx: InvocationCtx): Promise<void> {
    const arg = ctx.arg as { viewId: string };
    state().sideEffects.push(`activate:${arg.viewId}`);
}

/** Second step of a command sequence: proves ordering within the sequence. */
export async function recordFocus(ctx: InvocationCtx): Promise<void> {
    const arg = ctx.arg as { viewId: string };
    state().sideEffects.push(`focus:${arg.viewId}`);
}

/** An invocation that always throws, to test Error propagation. */
export async function alwaysThrows(): Promise<void> {
    throw new Error("boom from handler");
}

// ── Query invocations (produce data) ─────────────────────────────────────────────

/** Produces a row from the arg. */
export async function rowFromArg(ctx: InvocationCtx): Promise<unknown> {
    const arg = ctx.arg as { id: number };
    return { id: arg.id, kind: "row" };
}

/** Produces a second row, independent of the arg. */
export async function staticRow(): Promise<unknown> {
    return { id: 99, kind: "static" };
}

// ── Query reducer ────────────────────────────────────────────────────────────────

/** Folds the collected rows into a count + the rows. */
export async function countReducer(ctx: ReducerCtx): Promise<unknown> {
    const rows = ctx.acc as unknown[];
    return { count: rows.length, rows };
}

// ── Operation invocation (mutation that returns data) ────────────────────────────

/** Mutates the store and returns the new value. */
export async function incrementStore(ctx: InvocationCtx): Promise<unknown> {
    const arg = ctx.arg as { key: string; by: number };
    const s = state().store;
    s[arg.key] = (s[arg.key] ?? 0) + arg.by;
    return { key: arg.key, value: s[arg.key] };
}

/** Reducer that unwraps the single mutation result. */
export async function firstResult(ctx: ReducerCtx): Promise<unknown> {
    const results = ctx.acc as unknown[];
    return results[0] ?? null;
}

// ── Principal-aware invocations (TRN-535) ────────────────────────────────────────

/** Echoes the principal + tenant the run carries, proving InvocationCtx.sec threads. */
export async function echoPrincipal(ctx: InvocationCtx): Promise<unknown> {
    return { principalIri: ctx.sec.principalIri, tenantId: ctx.tenantId };
}

/** Fails closed unless a real (non-anonymous) principal is present. */
export async function requireRealPrincipal(ctx: InvocationCtx): Promise<void> {
    if (ctx.sec.principalIri == null) {
        throw new Error("denied: anonymous principal");
    }
    state().sideEffects.push(`allowed:${ctx.sec.principalIri}`);
}
