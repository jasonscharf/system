import { app } from "@jasonscharf/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let server: ReturnType<typeof app.listen>;
let BASE: string;

beforeAll(
    () =>
        new Promise<void>((resolve) => {
            server = app.listen(0, () => {
                const addr = server.address() as { port: number };
                BASE = `http://localhost:${addr.port}`;
                resolve();
            });
        }),
);

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("api", () => {
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
