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
        alias: {
            "@jasonscharf/core-ui": path.resolve(__dirname, "src"),
            "@system/core": pkg("core"),
            "@system/gen": pkg("gen"),
        },
    },
});
