import path from 'node:path';
import { defineConfig } from 'vitest/config';


export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['**/src/**/*.test.ts'],
        coverage: {
            //provider: 'v8',
            provider: 'v8',
            enabled: true,

            reportsDirectory: 'coverage/vitest',
            reporter: ['text-summary', 'html', 'lcov'],

            include: [
                '**/src/**/*.ts',
                '**/src/**/*.tsx',
            ],
            exclude: [
                '**/*.spec.*',
                '**/*.d.ts',
                '**/node_modules/**',
                '**/playwright/**',
            ],
        },

    },
    resolve: {
        alias: {
            '@system/api':  path.resolve(__dirname, '../api/src'),
            '@system/app':  path.resolve(__dirname, '../app/src'),
            '@system/core': path.resolve(__dirname, '../core/src'),
            '@system/data': path.resolve(__dirname, '../data/src'),
            '@system/flow': path.resolve(__dirname, '../flow/src'),
            '@system/test': path.resolve(__dirname, '../test/src'),
            '@system/worker': path.resolve(__dirname, '../worker/src'),
        },
    }
});
