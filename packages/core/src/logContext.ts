import { AsyncLocalStorage } from "node:async_hooks";
import { installLogContextReader } from "./SystemLogger.js";

/**
 * Ambient log fields: the identity of the work in flight, carried on every line
 * it produces without any call site restating it.
 *
 * A log line's `fields` say what the line is about. This says what the REQUEST
 * is about, and there is no sane way to thread that through by hand: the code
 * between the edge that authenticated a caller and the twentieth line logged on
 * their behalf is thousands of call sites deep and has no business knowing who
 * the caller is. So an edge binds it once:
 *
 *   await runWithLogContext({ userIri, sessionId }, next);
 *
 * and every line emitted inside that scope, including from async continuations,
 * carries userIri and sessionId. One user or one session is then greppable end
 * to end across a request.
 *
 * Node only. This module is deliberately absent from browser.ts: it is built on
 * node:async_hooks, which is the only thing that survives an `await`, and a
 * browser build cannot resolve it. Browser code keeps the same getLog() surface
 * and simply has no ambient fields.
 */
const storage = new AsyncLocalStorage<Record<string, unknown>>();

// Importing this module is what gives BoundLogger something to read. index.ts
// re-exports it, so any Node consumer of the package has it; browser.ts does
// not, which is the whole point.
installLogContextReader(() => storage.getStore());

/**
 * Runs `fn` with `fields` bound to every log line it and its async
 * continuations emit, and returns whatever `fn` returns.
 *
 * Nesting merges rather than replaces, inner winning: a WebSocket connection
 * bound inside an authenticated request keeps the request's userIri and adds
 * its own fields. That is why this takes the outer store and spreads it, rather
 * than handing `fields` straight to `run`.
 *
 * The callback is called synchronously, so a `() => Promise<T>` gives back the
 * promise and the scope stays bound for its whole chain.
 */
export function runWithLogContext<T>(fields: Record<string, unknown>, fn: () => T): T {
    const outer = storage.getStore();
    return storage.run(outer ? { ...outer, ...fields } : fields, fn);
}
