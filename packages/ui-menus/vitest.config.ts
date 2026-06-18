import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Package-local vitest config. Run from the repo root with:
//   yarn workspace @jasonscharf/ui-menus test
// The aliases resolve workspace packages to source so tests track edits without
// a build step, and bare `react-native` imports (pulled in via core-ui's React
// primitives) resolve to react-native-web under jsdom.
const pkg = (name: string): string => path.resolve(__dirname, `../${name}/src`);

export default defineConfig({
    plugins: [react()],
    test: {
        globals: true,
        environment: "node",
        include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
        coverage: {
            provider: "v8",
            enabled: false,
            include: ["src/**/*.ts", "src/**/*.tsx"],
            exclude: ["**/*.test.*", "**/*.d.ts", "**/*.generated.*", "test-app/**", "e2e/**"],
        },
    },
    resolve: {
        alias: {
            "react-native": "react-native-web",
            "@jasonscharf/ui-menus/react": path.resolve(__dirname, "src/react"),
            "@jasonscharf/ui-menus": path.resolve(__dirname, "src"),
            "@jasonscharf/core-ui/react": `${pkg("core-ui")}/react`,
            "@jasonscharf/core-ui": pkg("core-ui"),
            "@jasonscharf/core": pkg("core"),
            "@jasonscharf/entities": pkg("entities"),
        },
    },
});
