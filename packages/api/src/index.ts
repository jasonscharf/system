import { readFileSync } from "node:fs";
import Koa from "koa";

function loadVersion(): unknown {
    try {
        return JSON.parse(readFileSync(new URL("../version.json", import.meta.url), "utf8"));
    } catch {
        return { error: "version.json not available — run yarn build" };
    }
}

const VERSION = loadVersion();

export const app = new Koa();

app.use(async (ctx) => {
    if (ctx.method !== "GET") {
        ctx.status = 405;
        return;
    }

    if (ctx.path === "/") {
        ctx.body = { ok: true, server: "tern-api" };
    } else if (ctx.path === "/version") {
        ctx.body = VERSION;
    } else {
        ctx.status = 404;
        ctx.body = { error: "not found" };
    }
});
