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

const CREATE_WIDGET = typeRef("http://tern.dev/test/widget.create");
const PING = typeRef("http://tern.dev/test/ping");

const WIDGET_SHAPE: ShaclNodeShape = {
    targetClass: "http://tern.dev/test/Widget",
    properties: [
        {
            path: "http://tern.dev/test/name",
            minCount: 1,
            datatype: "http://www.w3.org/2001/XMLSchema#string",
        },
        {
            path: "http://tern.dev/test/color",
            minCount: 1,
            datatype: "http://www.w3.org/2001/XMLSchema#string",
        },
    ],
};

const WIDGET_PROP_MAP: Record<string, string> = {
    name: "http://tern.dev/test/name",
    color: "http://tern.dev/test/color",
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
    it("testHasShapeReturnsFalseForUnregisteredType", () => {
        const reg = new PayloadSchemaRegistry();
        expect(reg.hasShape(CREATE_WIDGET.iri)).toBe(false);
    });

    it("testHasShapeReturnsTrueAfterRegister", () => {
        const reg = new PayloadSchemaRegistry();
        reg.register(CREATE_WIDGET, WIDGET_SHAPE, WIDGET_PROP_MAP);
        expect(reg.hasShape(CREATE_WIDGET.iri)).toBe(true);
    });

    it("testValidateReturnsNullForUnregisteredType", () => {
        const reg = new PayloadSchemaRegistry();
        const result = reg.validate(CREATE_WIDGET.iri, { name: "x", color: "red" });
        expect(result).toBeNull();
    });

    it("testValidateReturnsValidForConformingPayload", () => {
        const reg = new PayloadSchemaRegistry();
        reg.register(CREATE_WIDGET, WIDGET_SHAPE, WIDGET_PROP_MAP);
        const result = reg.validate(CREATE_WIDGET.iri, { name: "Cog", color: "blue" });
        expect(result?.valid).toBe(true);
    });

    it("testValidateReturnsViolationsForMissingRequiredField", () => {
        const reg = new PayloadSchemaRegistry();
        reg.register(CREATE_WIDGET, WIDGET_SHAPE, WIDGET_PROP_MAP);
        const result = reg.validate(CREATE_WIDGET.iri, { name: "Cog" }); // missing color
        expect(result?.valid).toBe(false);
        expect(result?.violations.some((v) => v.property === "color")).toBe(true);
    });
});

describe("payloadValidation middleware", () => {
    it("testPassesThroughWhenNoShapeRegistered", async () => {
        const reg = new PayloadSchemaRegistry();
        const router = buildRouter(reg);
        const req = command(PING, { anything: true });
        const res = await router.dispatch(req, { connectionId: "c1" });
        expect(res.ok).toBe(true);
    });

    it("testPassesThroughWhenPayloadIsValidAgainstShape", async () => {
        const reg = new PayloadSchemaRegistry();
        reg.register(CREATE_WIDGET, WIDGET_SHAPE, WIDGET_PROP_MAP);
        const router = buildRouter(reg);

        const req = command(CREATE_WIDGET, { name: "Sprocket", color: "red" });
        const res = await router.dispatch(req, { connectionId: "c1" });
        expect(res.ok).toBe(true);
        expect((res.data as Record<string, unknown>).ok).toBe(true);
    });

    it("testRejectsPayloadViolatingShape", async () => {
        const reg = new PayloadSchemaRegistry();
        reg.register(CREATE_WIDGET, WIDGET_SHAPE, WIDGET_PROP_MAP);
        const router = buildRouter(reg);

        const req = command(CREATE_WIDGET, { name: "Sprocket" }); // missing color
        const res = await router.dispatch(req, { connectionId: "c1" });
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/color/i);
    });

    it("testRejectsNonObjectPayloadWhenShapeRegistered", async () => {
        const reg = new PayloadSchemaRegistry();
        reg.register(CREATE_WIDGET, WIDGET_SHAPE, WIDGET_PROP_MAP);
        const router = buildRouter(reg);

        const req = command(CREATE_WIDGET, "not-an-object");
        const res = await router.dispatch(req, { connectionId: "c1" });
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/payload must be an object/i);
    });

    it("testRejectsMissingPayloadWhenShapeRegistered", async () => {
        const reg = new PayloadSchemaRegistry();
        reg.register(CREATE_WIDGET, WIDGET_SHAPE, WIDGET_PROP_MAP);
        const router = buildRouter(reg);

        const req = command(CREATE_WIDGET); // no payload
        const res = await router.dispatch(req, { connectionId: "c1" });
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/payload must be an object/i);
    });

    it("testUnregisteredTypePassesThroughEvenWithNoPayload", async () => {
        const reg = new PayloadSchemaRegistry();
        const router = buildRouter(reg);
        const req = command(PING); // no payload, no shape
        const res = await router.dispatch(req, { connectionId: "c1" });
        expect(res.ok).toBe(true);
    });

    it("testErrorIncludesAllViolationFields", async () => {
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
