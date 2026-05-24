import { describe, expect, it } from "vitest";

// Side-effect import — executes the module (covers packages/api/src/index.ts)
import "@jasonscharf/api";

const PORT = Number(process.env.PORT ?? 3000);
const BASE = `http://localhost:${PORT}`;

describe("api", () => {
    it("loads without error", () => {
        // coverage provided by the top-level import
    });

    it("GET / returns ok:true", async () => {
        const res = await fetch(`${BASE}/`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.ok).toBe(true);
    });

    it("GET /version returns version info", async () => {
        const res = await fetch(`${BASE}/version`);
        expect(res.status).toBe(200);
    });

    it("POST / returns 405 Method Not Allowed", async () => {
        const res = await fetch(`${BASE}/`, { method: "POST" });
        expect(res.status).toBe(405);
    });

    it("GET /unknown returns 404", async () => {
        const res = await fetch(`${BASE}/no-such-path`);
        expect(res.status).toBe(404);
    });
});
