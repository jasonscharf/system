import type { DispatchKind } from "./types.js";

// ── Dispatch IRIs ────────────────────────────────────────────────────────────────
//
// Dispatch names are mapped to stable IRIs on the wire so the transport bus can
// route them.  The kind is part of the IRI so a command and an event sharing a
// name never collide on the queue.

const NS = "urn:tern:dispatch";

/** Build the wire IRI for a (kind, name) pair. */
export function dispatchIri(kind: DispatchKind, name: string): string {
    return `${NS}:${kind}:${name}`;
}

/**
 * The ISystemBus RPC kind used to carry a given dispatch kind across the queue.
 *
 * The bus exposes three RPC verbs (command/query/operation), each with a reply
 * round-trip.  Events are void+ack like commands, so they ride the command verb
 * but keep their own event-namespaced IRI — this gives events the SAME
 * completion/error round-trip as everything else (never fire-and-forget).
 */
export function rpcKindFor(kind: DispatchKind): "command" | "query" | "operation" {
    if (kind === "event") {
        return "command";
    }
    return kind;
}
