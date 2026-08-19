import { getLog } from "@jasonscharf/core";
import { app } from "./index.js";

const log = getLog("sys:api:server");

const PORT = Number(process.env.PORT ?? 3000);

app.listen(PORT, () => {
    log.info("listening", "HTTP server listening", { url: `http://0.0.0.0:${PORT}` });
});
