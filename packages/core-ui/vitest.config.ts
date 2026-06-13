import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Package-local vitest config. Run from the repo root with:
//   yarn workspace @jasonscharf/core-ui test
// The @system/* aliases mirror the portal symlinks used elsewhere in the repo
// so fixtures that reference them resolve to source.
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
            exclude: ["**/*.test.*", "**/*.d.ts", "test-app/**", "e2e/**"],
        },
    },
    resolve: {
        // Resolve bare `react-native` imports to react-native-web so the React
        // binding layer runs against the web implementation under jsdom. RNW is
        // the platform-agnostic UI direction; styling stays in classic .css via
        // className (RNW passes className through on web).
        alias: {
            "react-native": "react-native-web",
            "@jasonscharf/core-ui": path.resolve(__dirname, "src"),
            "@system/core": pkg("core"),
            "@system/gen": pkg("gen"),
        },
    },
});
