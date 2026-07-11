/**
 * TRN-535: the HandlerContext dispatch contract carries a SecurityContext.
 *
 * Real HandlerRegistry / SystemApp, real inline handlers — no mocks. The
 * observable signal is the principal a handler reads off `ctx.sec`, returned in
 * the SystemResult, plus a required-principal handler that fails closed on the
 * anonymous default.
 */

import { HandlerRegistry, SystemApp } from "@jasonscharf/app";
import {
    anonymousSec,
    errResult,
    okResult,
    query,
    type SecurityContext,
    SYSTEM_TYPES,
    systemSec,
} from "@jasonscharf/core";
import { describe, expect, it } from "vitest";

function principalOf(result: { data?: unknown }): string | null {
    return (result.data as { principalIri: string | null }).principalIri;
}

describe("HandlerContext carries a SecurityContext principal (TRN-535)", () => {
    it("a handler receives the principal the caller supplies", async () => {
        const reg = new HandlerRegistry();
        reg.registerInline(SYSTEM_TYPES.ping, async (req, ctx) =>
            okResult(req.id, req.type, {
                principalIri: ctx.sec.principalIri,
                tenantId: ctx.tenantId,
            }),
        );
        const r = await reg.dispatch(query(SYSTEM_TYPES.ping), {
            connectionId: "c1",
            sec: systemSec,
            tenantId: "tenant-1",
        });
        expect(r.ok).toBe(true);
        expect(principalOf(r)).toBe(systemSec.principalIri);
        expect((r.data as { tenantId: string | null }).tenantId).toBe("tenant-1");
    });

    it("defaults to anonymousSec when the caller omits sec", async () => {
        const reg = new HandlerRegistry();
        reg.registerInline(SYSTEM_TYPES.ping, async (req, ctx) =>
            okResult(req.id, req.type, { principalIri: ctx.sec.principalIri }),
        );
        const r = await reg.dispatch(query(SYSTEM_TYPES.ping), { connectionId: "c1" });
        expect(r.ok).toBe(true);
        expect(principalOf(r)).toBe(anonymousSec.principalIri);
        expect(principalOf(r)).toBeNull();
    });

    it("a required-principal handler denies the anonymous default", async () => {
        const reg = new HandlerRegistry();
        reg.registerInline(SYSTEM_TYPES.ping, async (req, ctx) => {
            if (ctx.sec.principalIri == null) {
                return errResult(req.id, req.type, "denied: authentication required");
            }
            return okResult(req.id, req.type, { principalIri: ctx.sec.principalIri });
        });

        // No principal supplied -> anonymous default -> denied (fail closed).
        // HandlerRegistry collapses a handler's own error into a generic message,
        // so the observable deny signal is `ok === false`.
        const denied = await reg.dispatch(query(SYSTEM_TYPES.ping), { connectionId: "c1" });
        expect(denied.ok).toBe(false);

        // A real principal is allowed through the same handler.
        const allowed = await reg.dispatch(query(SYSTEM_TYPES.ping), {
            connectionId: "c1",
            sec: systemSec,
        });
        expect(allowed.ok).toBe(true);
        expect(principalOf(allowed)).toBe(systemSec.principalIri);
    });

    it("SystemApp.dispatch threads the principal it is given to the handler", async () => {
        const app = SystemApp.fromEntries({ name: "test-app", extensions: [], handlers: [] }, []);
        app.register(SYSTEM_TYPES.ping, async (req, ctx) =>
            okResult(req.id, req.type, { principalIri: ctx.sec.principalIri }),
        );

        const sec: SecurityContext = systemSec;
        const withPrincipal = await app.dispatch(query(SYSTEM_TYPES.ping), "c1", sec);
        expect(withPrincipal.ok).toBe(true);
        expect(principalOf(withPrincipal)).toBe(systemSec.principalIri);

        // Default (no principal) dispatches as anonymous.
        const anon = await app.dispatch(query(SYSTEM_TYPES.ping), "c1");
        expect(anon.ok).toBe(true);
        expect(principalOf(anon)).toBeNull();
    });
});
