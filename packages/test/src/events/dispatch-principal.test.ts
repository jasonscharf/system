/**
 * TRN-535: the dispatch contract carries a SecurityContext principal.
 *
 * Proves the InvocationCtx side of the plumbing end-to-end with REAL components
 * (a real DefRegistry, the real Runner, the real InMemorySystemBus + DispatchHost
 * + BusDispatchProvider) and real fixture invocations resolved through the
 * module-ref loader — no mocks. The observable signal is the value an invocation
 * reads off `ctx.sec` / `ctx.tenantId`, carried back as the dispatch result or a
 * propagated Error.
 */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
    _clearModuleRefCache,
    anonymousSec,
    InMemorySystemBus,
    systemSec,
} from "@jasonscharf/core";
import { BusDispatchProvider, DefRegistry, DispatchHost, Runner } from "@jasonscharf/events";
import { beforeEach, describe, expect, it } from "vitest";
import { resetSideEffects, sideEffects } from "./__fixtures__/handlers.js";

// Contribute the names this suite dispatches to the ambient registries the same
// way a real consumer/extension would, so exec() args/results are type-checked.
declare module "@jasonscharf/events" {
    interface QueryRegistry {
        "principal.echo": null;
    }
    interface QueryResultRegistry {
        "principal.echo": Array<{ principalIri: string | null; tenantId: string | null }>;
    }
    interface CommandRegistry {
        "principal.guard": null;
    }
}

const FIXTURE = resolve(new URL(import.meta.url).pathname, "../__fixtures__/handlers.ts");
const FIXTURE_URL = pathToFileURL(FIXTURE).href;

function ref(member: string): string {
    return `module://${FIXTURE_URL}#${member}`;
}

function buildRegistry(): DefRegistry {
    const registry = new DefRegistry();
    registry.registerQuery("principal.echo", {
        invocations: [ref("echoPrincipal")],
        reducers: [],
    });
    registry.registerCommand("principal.guard", {
        invocations: [ref("requireRealPrincipal")],
    });
    return registry;
}

describe("dispatch carries a SecurityContext principal (TRN-535)", () => {
    beforeEach(() => {
        resetSideEffects();
        _clearModuleRefCache();
    });

    it("Runner threads the supplied principal + tenant onto ctx.sec/ctx.tenantId", async () => {
        const runner = new Runner(buildRegistry());
        const data = (await runner.run(
            "query",
            "principal.echo",
            null,
            systemSec,
            "tenant-1",
        )) as Array<{ principalIri: string | null; tenantId: string | null }>;
        expect(data[0].principalIri).toBe(systemSec.principalIri);
        expect(data[0].tenantId).toBe("tenant-1");
    });

    it("Runner defaults to anonymousSec when no principal is supplied", async () => {
        const runner = new Runner(buildRegistry());
        const data = (await runner.run("query", "principal.echo", null)) as Array<{
            principalIri: string | null;
            tenantId: string | null;
        }>;
        expect(data[0].principalIri).toBe(anonymousSec.principalIri);
        expect(data[0].principalIri).toBeNull();
        expect(data[0].tenantId).toBeNull();
    });

    it("a required-principal invocation denies anonymous but allows a real principal", async () => {
        const runner = new Runner(buildRegistry());
        // Anonymous (the default) is denied — fail closed.
        await expect(runner.run("command", "principal.guard", null)).rejects.toThrow(/denied/);
        expect(sideEffects).toEqual([]);
        // A real principal is allowed through.
        await expect(
            runner.run("command", "principal.guard", null, systemSec),
        ).resolves.toBeUndefined();
        expect(sideEffects).toEqual([`allowed:${systemSec.principalIri}`]);
    });

    it("a handler bound over the bus reads ctx.sec, defaulted to anonymous", async () => {
        const bus = new InMemorySystemBus();
        const host = new DispatchHost(bus, buildRegistry());
        const dispatch = new BusDispatchProvider(bus);
        await host.bind("query", "principal.echo");
        try {
            const data = await dispatch.query("principal.echo").exec(null);
            // The bus carries no principal yet (TRN-527 wires it), so the bound
            // handler runs as the safe anonymous default rather than undefined.
            expect(data[0].principalIri).toBeNull();
        } finally {
            await bus.close();
        }
    });
});
