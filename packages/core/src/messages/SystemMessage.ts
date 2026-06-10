import { makeUri, NS_CORE } from "../constants.js";
import { uuidv4Binary } from "../util/random.js";

// ── Wire format ───────────────────────────────────────────────────────────────
// All messages that cross process boundaries (WebSocket, etc.) are serialised
// to this shape.  IDs are UUID v4 strings so JSON round-trips are lossless.

export type SystemKind = "command" | "query" | "operation" | "event" | "result";

/**
 * A reference to a well-known message type registered in the datastore.
 *
 * The `iri` uniquely names the type across all processes and is always
 * present on the wire.  The `id` is the primary key from `sys_names` and
 * is populated locally by a SystemTypeResolver after the message enters a
 * process that holds a database connection; it enables O(1) dispatch tables
 * keyed by integer rather than string comparison.
 */
export interface SystemTypeRef {
    /** Full IRI of the type (e.g. "urn:sys:core:msg:ping"). */
    readonly iri: string;
    /** PK in sys_names — present only after local resolution; never sent on the wire. */
    readonly id?: number;
}

/** Resolve a plain IRI string into a SystemTypeRef (unresolved). */
export function typeRef(iri: string, id?: number): SystemTypeRef {
    return id !== undefined ? { iri, id } : { iri };
}

// ── Well-known message types ──────────────────────────────────────────────────

const NS = makeUri(NS_CORE, "msg");

export const SYSTEM_TYPES = {
    ping: typeRef(makeUri(NS, "ping")),
    echo: typeRef(makeUri(NS, "echo")),
    tripleInsert: typeRef(makeUri(NS, "triple.insert")),
    tripleFind: typeRef(makeUri(NS, "triple.find")),
    tripleDelete: typeRef(makeUri(NS, "triple.delete")),
    tripleStats: typeRef(makeUri(NS, "triple.stats")),
} as const satisfies Record<string, SystemTypeRef>;

// ── Message interfaces ────────────────────────────────────────────────────────

export interface SystemMessage {
    readonly id: string;
    readonly kind: SystemKind;
    /** Well-known type reference pointing to a registered name in the datastore. */
    readonly type: SystemTypeRef;
}

export interface SystemRequest extends SystemMessage {
    readonly kind: "command" | "query" | "operation" | "event";
    readonly payload?: unknown;
}

export interface SystemCommand extends SystemRequest {
    readonly kind: "command";
}

export interface SystemQuery extends SystemRequest {
    readonly kind: "query";
}

export interface SystemEvent extends SystemRequest {
    readonly kind: "event";
}

export interface SystemOperation extends SystemRequest {
    readonly kind: "operation";
}

export interface SystemResult extends SystemMessage {
    readonly kind: "result";
    readonly correlationId: string;
    readonly ok: boolean;
    readonly data?: unknown;
    readonly error?: string;
}

// ── Factories ─────────────────────────────────────────────────────────────────

function newId(): string {
    const bytes = uuidv4Binary();
    const hex = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20),
    ].join("-");
}

/** Create a SystemCommand from a well-known SystemTypeRef. */
export function command(type: SystemTypeRef, payload?: unknown): SystemCommand {
    return { id: newId(), kind: "command", type, payload };
}

/** Create a SystemQuery from a well-known SystemTypeRef. */
export function query(type: SystemTypeRef, payload?: unknown): SystemQuery {
    return { id: newId(), kind: "query", type, payload };
}

/** Create a SystemOperation from a well-known SystemTypeRef. */
export function operation(type: SystemTypeRef, payload?: unknown): SystemOperation {
    return { id: newId(), kind: "operation", type, payload };
}

/** Create a SystemEvent from a well-known SystemTypeRef. */
export function event(type: SystemTypeRef, payload?: unknown): SystemEvent {
    return { id: newId(), kind: "event", type, payload };
}

export function result(
    correlationId: string,
    type: SystemTypeRef,
    ok: boolean,
    data?: unknown,
    error?: string,
): SystemResult {
    return { id: newId(), kind: "result", correlationId, type, ok, data, error };
}

export function okResult(correlationId: string, type: SystemTypeRef, data?: unknown): SystemResult {
    return result(correlationId, type, true, data);
}

export function errResult(correlationId: string, type: SystemTypeRef, error: string): SystemResult {
    return result(correlationId, type, false, undefined, error);
}

// ── Guards ────────────────────────────────────────────────────────────────────

export function isSystemRequest(msg: unknown): msg is SystemRequest {
    if (typeof msg !== "object" || msg === null) {
        return false;
    }
    const m = msg as Record<string, unknown>;
    return (
        typeof m.id === "string" &&
        typeof m.kind === "string" &&
        typeof m.type === "object" &&
        m.type !== null &&
        typeof (m.type as Record<string, unknown>).iri === "string" &&
        (m.kind === "command" || m.kind === "query" || m.kind === "operation" || m.kind === "event")
    );
}

export function isSystemResult(msg: unknown): msg is SystemResult {
    if (typeof msg !== "object" || msg === null) {
        return false;
    }
    return (msg as Record<string, unknown>).kind === "result";
}
