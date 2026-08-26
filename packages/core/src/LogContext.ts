import { AsyncLocalStorage } from "node:async_hooks";
import { setAmbientLogFieldSource } from "./SystemLogger.js";

/**
 * Ambient log context (TRN-668).
 *
 * `runWithLogContext({ userIri, sessionId }, fn)` makes those fields ride on
 * EVERY log line emitted anywhere inside `fn`, however deep the call stack and
 * across awaits, without a single call site threading them by hand. A transport
 * edge binds the context once — an HTTP guard around `next()`, the dispatch
 * adapter around a handler — and the ten thousand `log.info(...)` calls below
 * it stay exactly as they are.
 *
 * Precedence is lowest of the three field sources: ambient fields, then a
 * logger's standing `child()` metadata, then per-call fields. A handler that
 * explicitly logs a `userIri` therefore always wins over the ambient one.
 *
 * Contexts nest: an inner `runWithLogContext` sees the outer fields merged
 * under its own, and leaving the inner scope restores the outer one. This is
 * plain AsyncLocalStorage semantics, so the context follows the async
 * execution, never the module graph — two concurrent requests each see only
 * their own fields.
 *
 * This module is server-only ON PURPOSE: `node:async_hooks` does not exist in
 * the browser, so `browser.ts` must never re-export it. SystemLogger stays
 * platform-neutral and reads ambient fields through the source registered
 * here, which in the browser simply never happens.
 */
const storage = new AsyncLocalStorage<Record<string, unknown>>();

setAmbientLogFieldSource(() => storage.getStore() ?? null);

/** Run `fn` with `fields` on every log line it emits, merged over any outer context. */
export function runWithLogContext<T>(fields: Record<string, unknown>, fn: () => T): T {
    return storage.run({ ...storage.getStore(), ...fields }, fn);
}

/** The current ambient log fields, or null outside any context. */
export function getLogContext(): Record<string, unknown> | null {
    return storage.getStore() ?? null;
}
