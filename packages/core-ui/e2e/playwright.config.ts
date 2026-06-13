import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

// E2E config driving the Vite test-app. The webServer block boots the test app
// on port 5174 and waits for it before running specs. Run with:
//   yarn workspace @jasonscharf/core-ui e2e
const here = path.dirname(fileURLToPath(import.meta.url));
const port = 5191;

export default defineConfig({
    testDir: ".",
    timeout: 30_000,
    use: {
        baseURL: `http://localhost:${port}`,
        headless: true,
    },
    webServer: {
        command: "vite --config test-app/vite.config.ts",
        cwd: path.resolve(here, ".."),
        port,
        // Always boot a fresh, known-good instance of the test app so a stray
        // server squatting on the port can never be mistaken for ours.
        reuseExistingServer: false,
        timeout: 60_000,
    },
});
