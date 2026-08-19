import { getLogger } from "@jasonscharf/core";
import { app } from "./index.js";

const log = getLogger("api");

const PORT = Number(process.env.PORT ?? 3000);

app.listen(PORT, () => {
    log.info("HTTP listening", { url: `http://0.0.0.0:${PORT}` });
});
