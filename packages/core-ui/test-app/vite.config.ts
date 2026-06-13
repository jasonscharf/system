import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Standalone dev/test app for core-ui. It mounts a shell with named regions,
// sample views bound to view-models, and a config-driven menu — exercising
// composition-by-configuration end to end. Driven by Playwright in e2e/.
export default defineConfig({
    root: __dirname,
    plugins: [react()],
    resolve: {
        alias: {
            // Resolve the library to source so the test app tracks edits without
            // a build step.
            "@jasonscharf/core-ui/react": path.resolve(__dirname, "../src/react/index.ts"),
            "@jasonscharf/core-ui": path.resolve(__dirname, "../src/index.ts"),
        },
    },
    server: {
        port: 5191,
        strictPort: true,
        host: "0.0.0.0",
    },
});
