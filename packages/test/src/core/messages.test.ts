import {
    command,
    errResult,
    event,
    isSystemRequest,
    isSystemResult,
    okResult,
    query,
    result,
    SYSTEM_TYPES,
    typeRef,
} from "@jasonscharf/core";
import { describe, expect, it } from "vitest";

describe("typeRef", () => {
    it("creates a ref with only iri when id omitted", () => {
        const ref = typeRef("http://example.org/thing");
        expect(ref.iri).toBe("http://example.org/thing");
        expect(ref.id).toBeUndefined();
    });

    it("creates a ref with both iri and id", () => {
        const ref = typeRef("http://example.org/thing", 42);
        expect(ref.iri).toBe("http://example.org/thing");
        expect(ref.id).toBe(42);
    });
});

describe("command", () => {
    it("creates a SystemCommand with kind=command", () => {
        const msg = command(SYSTEM_TYPES.ping);
        expect(msg.kind).toBe("command");
        expect(msg.type.iri).toBe(SYSTEM_TYPES.ping.iri);
        expect(typeof msg.id).toBe("string");
        expect(msg.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("includes payload when provided", () => {
        const msg = command(SYSTEM_TYPES.ping, { x: 1 });
        expect(msg.payload).toEqual({ x: 1 });
    });
});

describe("query", () => {
    it("creates a SystemQuery with kind=query", () => {
        const msg = query(SYSTEM_TYPES.tripleFind, { subject: null });
        expect(msg.kind).toBe("query");
        expect(msg.payload).toEqual({ subject: null });
    });
});

describe("event", () => {
    it("creates a SystemEvent with kind=event", () => {
        const msg = event(SYSTEM_TYPES.ping);
        expect(msg.kind).toBe("event");
        expect(msg.type).toBe(SYSTEM_TYPES.ping);
    });

    it("includes payload", () => {
        const msg = event(SYSTEM_TYPES.ping, { ts: 42 });
        expect(msg.payload).toEqual({ ts: 42 });
    });
});

describe("result / okResult / errResult", () => {
    it("result creates a SystemResult with supplied fields", () => {
        const r = result("corr-1", SYSTEM_TYPES.ping, true, { pong: true });
        expect(r.kind).toBe("result");
        expect(r.correlationId).toBe("corr-1");
        expect(r.ok).toBe(true);
        expect(r.data).toEqual({ pong: true });
        expect(r.error).toBeUndefined();
    });

    it("result carries error when ok=false", () => {
        const r = result("c", SYSTEM_TYPES.ping, false, undefined, "boom");
        expect(r.ok).toBe(false);
        expect(r.error).toBe("boom");
    });

    it("okResult shorthand", () => {
        const r = okResult("c", SYSTEM_TYPES.ping, 42);
        expect(r.ok).toBe(true);
        expect(r.data).toBe(42);
    });

    it("errResult shorthand", () => {
        const r = errResult("c", SYSTEM_TYPES.ping, "failed");
        expect(r.ok).toBe(false);
        expect(r.error).toBe("failed");
    });
});

describe("isSystemRequest", () => {
    it("returns true for a valid command", () => {
        expect(isSystemRequest(command(SYSTEM_TYPES.ping))).toBe(true);
    });

    it("returns true for a valid query", () => {
        expect(isSystemRequest(query(SYSTEM_TYPES.ping))).toBe(true);
    });

    it("returns true for a valid event", () => {
        expect(isSystemRequest(event(SYSTEM_TYPES.ping))).toBe(true);
    });

    it("returns false for null", () => {
        expect(isSystemRequest(null)).toBe(false);
    });

    it("returns false for a non-object", () => {
        expect(isSystemRequest("string")).toBe(false);
        expect(isSystemRequest(42)).toBe(false);
    });

    it("returns false when kind is result", () => {
        expect(isSystemRequest(okResult("c", SYSTEM_TYPES.ping))).toBe(false);
    });

    it("returns false when type.iri is missing", () => {
        expect(isSystemRequest({ id: "x", kind: "command", type: { noIri: true } })).toBe(false);
    });

    it("returns false when type is not an object", () => {
        expect(isSystemRequest({ id: "x", kind: "command", type: "not-an-obj" })).toBe(false);
    });

    it("returns false when type is null", () => {
        expect(isSystemRequest({ id: "x", kind: "command", type: null })).toBe(false);
    });
});

describe("isSystemResult", () => {
    it("returns true for a SystemResult", () => {
        expect(isSystemResult(okResult("c", SYSTEM_TYPES.ping))).toBe(true);
    });

    it("returns false for a SystemRequest", () => {
        expect(isSystemResult(command(SYSTEM_TYPES.ping))).toBe(false);
    });

    it("returns false for null", () => {
        expect(isSystemResult(null)).toBe(false);
    });

    it("returns false for non-object", () => {
        expect(isSystemResult("x")).toBe(false);
    });
});
