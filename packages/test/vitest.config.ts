import path from 'node:path';
import { defineConfig } from 'vitest/config';


const workspaceRoot = path.resolve(__dirname, '../..');

export default defineConfig({
    root: workspaceRoot,
    test: {
        globals: true,
        environment: 'node',
        include: ['packages/test/src/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            enabled: true,
            reportsDirectory: path.resolve(__dirname, 'coverage/vitest'),
            reporter: ['text', 'html', 'lcov'],

            include: ['packages/*/src/**/*.ts'],
            exclude: [
                '**/*.d.ts',
                '**/node_modules/**',
                '**/dist/**',
                '**/gen/src/bin.ts',
            ],
        },
    },
    resolve: {
        alias: {
            '@system/api':     path.resolve(__dirname, '../api/src'),
            '@system/app':     path.resolve(__dirname, '../app/src'),
            '@system/auth':    path.resolve(__dirname, '../auth/src'),
            '@system/core':    path.resolve(__dirname, '../core/src'),
            '@system/data':    path.resolve(__dirname, '../data/src'),
            '@system/flow':    path.resolve(__dirname, '../flow/src'),
            '@system/gen':     path.resolve(__dirname, '../gen/src'),
            '@system/vaults':  path.resolve(__dirname, '../vaults/src'),
            '@system/test':    path.resolve(__dirname, '../test/src'),
            '@system/worker':  path.resolve(__dirname, '../worker/src'),
        },
    },
});
