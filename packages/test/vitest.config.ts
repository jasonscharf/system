import path from "node:path";
import { defineConfig } from "vitest/config";

const workspaceRoot = path.resolve(__dirname, "../..");

const pkg = (name: string) => path.resolve(__dirname, `../${name}/src`);

export default defineConfig({
    root: workspaceRoot,
    test: {
        globals: true,
        environment: "node",
        include: ["packages/test/src/**/*.test.ts"],
        coverage: {
            provider: "v8",
            enabled: true,
            reportsDirectory: path.resolve(__dirname, "coverage/vitest"),
            reporter: ["text", "html", "lcov"],
            include: ["packages/*/src/**/*.ts"],
            exclude: [
                "**/*.d.ts",
                "**/node_modules/**",
                "**/dist/**",
                "**/gen/src/bin.ts",
                "**/sandbox-*/src/**",
            ],
        },
    },
    resolve: {
        alias: {
            // Primary package names
            "@jasonscharf/api": pkg("api"),
            "@jasonscharf/app": pkg("app"),
            "@jasonscharf/auth": pkg("auth"),
            "@jasonscharf/convos": pkg("convos"),
            "@jasonscharf/core": pkg("core"),
            "@jasonscharf/data": pkg("data"),
            "@jasonscharf/entities": pkg("entities"),
            "@jasonscharf/flow": pkg("flow"),
            "@jasonscharf/gen": pkg("gen"),
            "@jasonscharf/rbac": pkg("rbac"),
            "@jasonscharf/server": pkg("server"),
            "@jasonscharf/vaults": pkg("vaults"),
            "@jasonscharf/worker": pkg("worker"),
            // Legacy aliases used in config/codegen test fixtures
            "@system/api": pkg("api"),
            "@system/app": pkg("app"),
            "@system/auth": pkg("auth"),
            "@system/core": pkg("core"),
            "@system/data": pkg("data"),
            "@system/entities": pkg("entities"),
            "@system/flow": pkg("flow"),
            "@system/gen": pkg("gen"),
            "@system/server": pkg("server"),
            "@system/vaults": pkg("vaults"),
            "@system/worker": pkg("worker"),
        },
    },
});
