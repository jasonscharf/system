import { app } from "./index.js";

const PORT = Number(process.env.PORT ?? 3000);

app.listen(PORT, () => {
    console.log(`[api] HTTP → http://0.0.0.0:${PORT}`);
});
