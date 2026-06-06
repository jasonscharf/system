import { uuidv4Binary } from "../util/random.js";

// ── Wire format ───────────────────────────────────────────────────────────────
// All messages that cross process boundaries (WebSocket, etc.) are serialised
// to this shape.  IDs are UUID v4 strings so JSON round-trips are lossless.

export type TernKind = "command" | "query" | "operation" | "event" | "result";

/**
 * A reference to a well-known message type registered in the datastore.
 *
 * The `iri` uniquely names the type across all processes and is always
 * present on the wire.  The `id` is the primary key from `tern_names` and
 * is populated locally by a TernTypeResolver after the message enters a
 * process that holds a database connection; it enables O(1) dispatch tables
 * keyed by integer rather than string comparison.
 */
export interface TernTypeRef {
    /** Full IRI of the type (e.g. "urn:tern:core:msg:ping"). */
    readonly iri: string;
    /** PK in tern_names — present only after local resolution; never sent on the wire. */
    readonly id?: number;
}

/** Resolve a plain IRI string into a TernTypeRef (unresolved). */
export function typeRef(iri: string, id?: number): TernTypeRef {
    return id !== undefined ? { iri, id } : { iri };
}

// ── Well-known message types ──────────────────────────────────────────────────

const NS = "urn:tern:core:msg:";

export const TERN_TYPES = {
    ping: typeRef(`${NS}ping`),
    echo: typeRef(`${NS}echo`),
    tripleInsert: typeRef(`${NS}triple.insert`),
    tripleFind: typeRef(`${NS}triple.find`),
    tripleDelete: typeRef(`${NS}triple.delete`),
    tripleStats: typeRef(`${NS}triple.stats`),
} as const satisfies Record<string, TernTypeRef>;

// ── Message interfaces ────────────────────────────────────────────────────────

export interface TernMessage {
    readonly id: string;
    readonly kind: TernKind;
    /** Well-known type reference pointing to a registered name in the datastore. */
    readonly type: TernTypeRef;
}

export interface TernRequest extends TernMessage {
    readonly kind: "command" | "query" | "operation" | "event";
    readonly payload?: unknown;
}

export interface TernCommand extends TernRequest {
    readonly kind: "command";
}

export interface TernQuery extends TernRequest {
    readonly kind: "query";
}

export interface TernEvent extends TernRequest {
    readonly kind: "event";
}

export interface TernOperation extends TernRequest {
    readonly kind: "operation";
}

export interface TernResult extends TernMessage {
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

/** Create a TernCommand from a well-known TernTypeRef. */
export function command(type: TernTypeRef, payload?: unknown): TernCommand {
    return { id: newId(), kind: "command", type, payload };
}

/** Create a TernQuery from a well-known TernTypeRef. */
export function query(type: TernTypeRef, payload?: unknown): TernQuery {
    return { id: newId(), kind: "query", type, payload };
}

/** Create a TernOperation from a well-known TernTypeRef. */
export function operation(type: TernTypeRef, payload?: unknown): TernOperation {
    return { id: newId(), kind: "operation", type, payload };
}

/** Create a TernEvent from a well-known TernTypeRef. */
export function event(type: TernTypeRef, payload?: unknown): TernEvent {
    return { id: newId(), kind: "event", type, payload };
}

export function result(
    correlationId: string,
    type: TernTypeRef,
    ok: boolean,
    data?: unknown,
    error?: string,
): TernResult {
    return { id: newId(), kind: "result", correlationId, type, ok, data, error };
}

export function okResult(correlationId: string, type: TernTypeRef, data?: unknown): TernResult {
    return result(correlationId, type, true, data);
}

export function errResult(correlationId: string, type: TernTypeRef, error: string): TernResult {
    return result(correlationId, type, false, undefined, error);
}

// ── Guards ────────────────────────────────────────────────────────────────────

export function isTernRequest(msg: unknown): msg is TernRequest {
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

export function isTernResult(msg: unknown): msg is TernResult {
    if (typeof msg !== "object" || msg === null) {
        return false;
    }
    return (msg as Record<string, unknown>).kind === "result";
}
