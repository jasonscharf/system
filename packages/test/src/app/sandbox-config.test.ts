/**
 * TRN-530 — regression test for the sandbox-server ping/echo IRI migration.
 *
 * Loads the *real* sandbox-server application config (config/app.yaml plus its
 * YAML/Turtle extension files) and proves that ping and echo requests dispatch
 * to their handlers under the same IRIs that SystemMessage.SYSTEM_TYPES emits.
 *
 * Before the fix, core.yaml/echo.yaml registered handlers under the stale
 * "http://tern.dev/ns/msg/ping|echo" IRIs while code dispatched
 * "urn:sys:core:msg:ping|echo" — so both endpoints were dead-lettered at
 * runtime.  This is a real round-trip against the loaded registry, no mocks.
 */

import { fileURLToPath } from "node:url";
import { SystemApp } from "@jasonscharf/app";
import { command, query, SYSTEM_TYPES } from "@jasonscharf/core";
import { describe, expect, it } from "vitest";

const SANDBOX_APP_CONFIG = fileURLToPath(
    new URL("../../../sandbox-server/config/app.yaml", import.meta.url),
);

describe("sandbox-server config: ping/echo IRI wiring (TRN-530)", () => {
    it("registers ping and echo under the SYSTEM_TYPES dispatch IRIs", async () => {
        const app = await SystemApp.fromYAML(SANDBOX_APP_CONFIG);
        const types = app.registry.registeredTypes;

        expect(types).toContain(SYSTEM_TYPES.ping.iri);
        expect(types).toContain(SYSTEM_TYPES.echo.iri);
        // The stale IRIs from the missed migration must be gone.
        expect(types).not.toContain("http://tern.dev/ns/msg/ping");
        expect(types).not.toContain("http://tern.dev/ns/msg/echo");
    });

    it("dispatches a ping request to handlePing (real round-trip)", async () => {
        const app = await SystemApp.fromYAML(SANDBOX_APP_CONFIG);
        const result = await app.dispatch(query(SYSTEM_TYPES.ping), "conn-1");

        expect(result.ok).toBe(true);
        expect(result.error).toBeUndefined();
        expect((result.data as { ts: number }).ts).toBeTypeOf("number");
    });

    it("dispatches an echo request to handleEcho (real round-trip)", async () => {
        const app = await SystemApp.fromYAML(SANDBOX_APP_CONFIG);
        const result = await app.dispatch(
            command(SYSTEM_TYPES.echo, { message: "hello" }),
            "conn-2",
        );

        expect(result.ok).toBe(true);
        expect(result.error).toBeUndefined();
        const data = result.data as { echo: string; original: string; receivedAt: number };
        expect(data.echo).toBe("HELLO");
        expect(data.original).toBe("hello");
        expect(data.receivedAt).toBeTypeOf("number");
    });
});
