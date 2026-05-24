import {
    command,
    errResult,
    event,
    isTernRequest,
    isTernResult,
    okResult,
    query,
    result,
    TERN_TYPES,
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
    it("creates a TernCommand with kind=command", () => {
        const msg = command(TERN_TYPES.ping);
        expect(msg.kind).toBe("command");
        expect(msg.type.iri).toBe(TERN_TYPES.ping.iri);
        expect(typeof msg.id).toBe("string");
        expect(msg.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("includes payload when provided", () => {
        const msg = command(TERN_TYPES.ping, { x: 1 });
        expect(msg.payload).toEqual({ x: 1 });
    });
});

describe("query", () => {
    it("creates a TernQuery with kind=query", () => {
        const msg = query(TERN_TYPES.tripleFind, { subject: null });
        expect(msg.kind).toBe("query");
        expect(msg.payload).toEqual({ subject: null });
    });
});

describe("event", () => {
    it("creates a TernEvent with kind=event", () => {
        const msg = event(TERN_TYPES.ping);
        expect(msg.kind).toBe("event");
        expect(msg.type).toBe(TERN_TYPES.ping);
    });

    it("includes payload", () => {
        const msg = event(TERN_TYPES.ping, { ts: 42 });
        expect(msg.payload).toEqual({ ts: 42 });
    });
});

describe("result / okResult / errResult", () => {
    it("result creates a TernResult with supplied fields", () => {
        const r = result("corr-1", TERN_TYPES.ping, true, { pong: true });
        expect(r.kind).toBe("result");
        expect(r.correlationId).toBe("corr-1");
        expect(r.ok).toBe(true);
        expect(r.data).toEqual({ pong: true });
        expect(r.error).toBeUndefined();
    });

    it("result carries error when ok=false", () => {
        const r = result("c", TERN_TYPES.ping, false, undefined, "boom");
        expect(r.ok).toBe(false);
        expect(r.error).toBe("boom");
    });

    it("okResult shorthand", () => {
        const r = okResult("c", TERN_TYPES.ping, 42);
        expect(r.ok).toBe(true);
        expect(r.data).toBe(42);
    });

    it("errResult shorthand", () => {
        const r = errResult("c", TERN_TYPES.ping, "failed");
        expect(r.ok).toBe(false);
        expect(r.error).toBe("failed");
    });
});

describe("isTernRequest", () => {
    it("returns true for a valid command", () => {
        expect(isTernRequest(command(TERN_TYPES.ping))).toBe(true);
    });

    it("returns true for a valid query", () => {
        expect(isTernRequest(query(TERN_TYPES.ping))).toBe(true);
    });

    it("returns true for a valid event", () => {
        expect(isTernRequest(event(TERN_TYPES.ping))).toBe(true);
    });

    it("returns false for null", () => {
        expect(isTernRequest(null)).toBe(false);
    });

    it("returns false for a non-object", () => {
        expect(isTernRequest("string")).toBe(false);
        expect(isTernRequest(42)).toBe(false);
    });

    it("returns false when kind is result", () => {
        expect(isTernRequest(okResult("c", TERN_TYPES.ping))).toBe(false);
    });

    it("returns false when type.iri is missing", () => {
        expect(isTernRequest({ id: "x", kind: "command", type: { noIri: true } })).toBe(false);
    });

    it("returns false when type is not an object", () => {
        expect(isTernRequest({ id: "x", kind: "command", type: "not-an-obj" })).toBe(false);
    });

    it("returns false when type is null", () => {
        expect(isTernRequest({ id: "x", kind: "command", type: null })).toBe(false);
    });
});

describe("isTernResult", () => {
    it("returns true for a TernResult", () => {
        expect(isTernResult(okResult("c", TERN_TYPES.ping))).toBe(true);
    });

    it("returns false for a TernRequest", () => {
        expect(isTernResult(command(TERN_TYPES.ping))).toBe(false);
    });

    it("returns false for null", () => {
        expect(isTernResult(null)).toBe(false);
    });

    it("returns false for non-object", () => {
        expect(isTernResult("x")).toBe(false);
    });
});
