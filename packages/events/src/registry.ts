// ── Ambient typing registry ──────────────────────────────────────────────────────
//
// Strong, extensible typing for dispatch via declaration-merging keyed by the
// string-literal dispatch name.  Core ships these four EMPTY interfaces; every
// extension package augments them with `declare module` to map a literal name
// to its arg type.  Because the interfaces are global to the module, the
// name->arg-type mapping is process-wide and fully type-checked, and the arg
// type flows through `exec(arg)` with autocomplete.
//
// Example (in an extension package):
//
//   declare module "@jasonscharf/events" {
//       interface CommandRegistry {
//           "view.activate": { viewId: string; focus?: boolean };
//       }
//   }
//
// After that augmentation, `dispatch.command("view.activate").exec({...})`
// requires `{ viewId: string; focus?: boolean }` and autocompletes its members.

/* eslint-disable @typescript-eslint/no-empty-interface */

/** Registry mapping command names to their single JSON arg type. */
// biome-ignore lint/suspicious/noEmptyInterface: extension packages augment this via declaration merging.
export interface CommandRegistry {}

/** Registry mapping event names to their single JSON arg type. */
// biome-ignore lint/suspicious/noEmptyInterface: extension packages augment this via declaration merging.
export interface EventRegistry {}

/** Registry mapping query names to their single JSON arg type. */
// biome-ignore lint/suspicious/noEmptyInterface: extension packages augment this via declaration merging.
export interface QueryRegistry {}

/** Registry mapping operation names to their single JSON arg type. */
// biome-ignore lint/suspicious/noEmptyInterface: extension packages augment this via declaration merging.
export interface OperationRegistry {}

/**
 * Registry mapping query/operation names to their RETURNED data-set type.
 * Optional: a name absent here returns `unknown` from `exec`.  Augment the
 * same way as the arg registries.
 */
// biome-ignore lint/suspicious/noEmptyInterface: extension packages augment this via declaration merging.
export interface QueryResultRegistry {}

// biome-ignore lint/suspicious/noEmptyInterface: extension packages augment this via declaration merging.
export interface OperationResultRegistry {}

// ── Name + arg-type helpers ──────────────────────────────────────────────────────
//
// When a registry has contributed entries, the name parameter is constrained to
// the known literal union and the arg type is looked up from the registry.
// When a registry is empty (no augmentation in scope), names fall back to plain
// `string` and args to a permissive JSON value, so the package is usable before
// any extension contributes types.

/** A JSON-serializable value — the lowest common denominator for an arg. */
export type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonValue[]
    | { [key: string]: JsonValue };

/** The set of registered names for a registry, or `string` if none. */
export type NameOf<R> = keyof R extends never ? string : keyof R & string;

/**
 * The arg type for a given name in a registry.  If the name is a known key,
 * its mapped type; otherwise a permissive JSON value.
 */
export type ArgOf<R, N extends string> = N extends keyof R ? R[N] : JsonValue;

/** The result type for a given name in a result-registry, else `unknown`. */
export type ResultOf<R, N extends string> = N extends keyof R ? R[N] : unknown;
