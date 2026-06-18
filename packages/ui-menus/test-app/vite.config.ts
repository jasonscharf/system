import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Standalone dev/test app for ui-menus. It mounts a core-ui composition shell
// (named regions + sample views) AND config-driven menus rendered by MenuView,
// exercising regions + menus end to end. Driven by Playwright in e2e/.
const pkg = (name: string): string => path.resolve(__dirname, `../../${name}/src`);

export default defineConfig({
    root: __dirname,
    plugins: [react()],
    resolve: {
        // core-ui's primitives are loaded from packages/core-ui while this app
        // resolves from packages/ui-menus; dedupe so there is a single React /
        // react-native-web instance (otherwise hooks fail and nothing mounts).
        dedupe: ["react", "react-dom", "react-native-web"],
        alias: {
            // RNW on web (core-ui primitives render to DOM via react-native-web).
            "react-native": "react-native-web",
            // Resolve the libraries to source so the test app tracks edits.
            "@jasonscharf/ui-menus/react": path.resolve(__dirname, "../src/react/index.ts"),
            "@jasonscharf/ui-menus": path.resolve(__dirname, "../src/index.ts"),
            "@jasonscharf/core-ui/react": `${pkg("core-ui")}/react/index.ts`,
            "@jasonscharf/core-ui": `${pkg("core-ui")}/index.ts`,
        },
    },
    server: {
        port: 5192,
        strictPort: true,
        host: "0.0.0.0",
    },
});
