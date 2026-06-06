/**
 * Dispatch-time payload validation tests.
 *
 * Verifies that the payloadValidation middleware short-circuits with an error
 * TernResult when the incoming payload violates the registered SHACL shape,
 * and passes through normally when the shape is satisfied or unregistered.
 */

import { command, okResult, typeRef } from "@jasonscharf/core";
import { PayloadSchemaRegistry, payloadValidation, TernRouter } from "@jasonscharf/app";
import type { ShaclNodeShape } from "@jasonscharf/gen";
import { describe, expect, it } from "vitest";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CREATE_WIDGET = typeRef("urn:sys:test:widget.create");
const PING = typeRef("urn:sys:test:ping");

const WIDGET_SHAPE: ShaclNodeShape = {
    iri: "urn:sys:test:WidgetShape",
    targetClass: "urn:sys:test:Widget",
    properties: [
        {
            path: "urn:sys:test:name",
            minCount: 1,
            datatype: "http://www.w3.org/2001/XMLSchema#string",
        },
        {
            path: "urn:sys:test:color",
            minCount: 1,
            datatype: "http://www.w3.org/2001/XMLSchema#string",
        },
    ],
};

const WIDGET_PROP_MAP: Record<string, string> = {
    name: "urn:sys:test:name",
    color: "urn:sys:test:color",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildRouter(registry: PayloadSchemaRegistry): TernRouter {
    const router = new TernRouter();
    router.use(payloadValidation(registry));
    router.handle(CREATE_WIDGET, async (ctx) => {
        ctx.result = okResult(ctx.request.id, ctx.request.type, { ok: true });
    });
    router.handle(PING, async (ctx) => {
        ctx.result = okResult(ctx.request.id, ctx.request.type, { pong: true });
    });
    return router;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PayloadSchemaRegistry", () => {
    it("test has shape returns false for unregistered type", () => {
        const reg = new PayloadSchemaRegistry();
        expect(reg.hasShape(CREATE_WIDGET.iri)).toBe(false);
    });

    it("test has shape returns true after register", () => {
        const reg = new PayloadSchemaRegistry();
        reg.register(CREATE_WIDGET, WIDGET_SHAPE, WIDGET_PROP_MAP);
        expect(reg.hasShape(CREATE_WIDGET.iri)).toBe(true);
    });

    it("test validate returns null for unregistered type", () => {
        const reg = new PayloadSchemaRegistry();
        const result = reg.validate(CREATE_WIDGET.iri, { name: "x", color: "red" });
        expect(result).toBeNull();
    });

    it("test validate returns valid for conforming payload", () => {
        const reg = new PayloadSchemaRegistry();
        reg.register(CREATE_WIDGET, WIDGET_SHAPE, WIDGET_PROP_MAP);
        const result = reg.validate(CREATE_WIDGET.iri, { name: "Cog", color: "blue" });
        expect(result?.valid).toBe(true);
    });

    it("test validate returns violations for missing required field", () => {
        const reg = new PayloadSchemaRegistry();
        reg.register(CREATE_WIDGET, WIDGET_SHAPE, WIDGET_PROP_MAP);
        const result = reg.validate(CREATE_WIDGET.iri, { name: "Cog" }); // missing color
        expect(result?.valid).toBe(false);
        expect(result?.violations.some((v) => v.property === "color")).toBe(true);
    });
});

describe("payloadValidation middleware", () => {
    it("test passes through when no shape registered", async () => {
        const reg = new PayloadSchemaRegistry();
        const router = buildRouter(reg);
        const req = command(PING, { anything: true });
        const res = await router.dispatch(req, { connectionId: "c1" });
        expect(res.ok).toBe(true);
    });

    it("test passes through when payload is valid against shape", async () => {
        const reg = new PayloadSchemaRegistry();
        reg.register(CREATE_WIDGET, WIDGET_SHAPE, WIDGET_PROP_MAP);
        const router = buildRouter(reg);

        const req = command(CREATE_WIDGET, { name: "Sprocket", color: "red" });
        const res = await router.dispatch(req, { connectionId: "c1" });
        expect(res.ok).toBe(true);
        expect((res.data as Record<string, unknown>).ok).toBe(true);
    });

    it("test rejects payload violating shape", async () => {
        const reg = new PayloadSchemaRegistry();
        reg.register(CREATE_WIDGET, WIDGET_SHAPE, WIDGET_PROP_MAP);
        const router = buildRouter(reg);

        const req = command(CREATE_WIDGET, { name: "Sprocket" }); // missing color
        const res = await router.dispatch(req, { connectionId: "c1" });
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/color/i);
    });

    it("test rejects non object payload when shape registered", async () => {
        const reg = new PayloadSchemaRegistry();
        reg.register(CREATE_WIDGET, WIDGET_SHAPE, WIDGET_PROP_MAP);
        const router = buildRouter(reg);

        const req = command(CREATE_WIDGET, "not-an-object");
        const res = await router.dispatch(req, { connectionId: "c1" });
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/payload must be an object/i);
    });

    it("test rejects missing payload when shape registered", async () => {
        const reg = new PayloadSchemaRegistry();
        reg.register(CREATE_WIDGET, WIDGET_SHAPE, WIDGET_PROP_MAP);
        const router = buildRouter(reg);

        const req = command(CREATE_WIDGET); // no payload
        const res = await router.dispatch(req, { connectionId: "c1" });
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/payload must be an object/i);
    });

    it("test unregistered type passes through even with no payload", async () => {
        const reg = new PayloadSchemaRegistry();
        const router = buildRouter(reg);
        const req = command(PING); // no payload, no shape
        const res = await router.dispatch(req, { connectionId: "c1" });
        expect(res.ok).toBe(true);
    });

    it("test error includes all violation fields", async () => {
        const reg = new PayloadSchemaRegistry();
        reg.register(CREATE_WIDGET, WIDGET_SHAPE, WIDGET_PROP_MAP);
        const router = buildRouter(reg);

        const req = command(CREATE_WIDGET, {}); // missing both name and color
        const res = await router.dispatch(req, { connectionId: "c1" });
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/name/i);
        expect(res.error).toMatch(/color/i);
    });
});
