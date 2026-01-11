import path from 'node:path';
import { defineConfig } from 'vitest/config';


export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: [
            'packages/**/src/**/*.tests.ts',
            'packages/**/src/**/*.test.ts',
        ],
        coverage: {
            provider: 'v8',
            enabled: true,

            reportsDirectory: 'coverage/vitest',
            reporter: ['text-summary', 'html', 'lcov'],

            include: [
                'packages/**/src/**/*.ts',
                'packages/**/src/**/*.tsx',
            ],
            exclude: [
                '**/*.test.*',
                '**/*.tests.*',
                '**/*.spec.*',
                '**/*.d.ts',
                '**/dist/**',
                '**/node_modules/**',
                '**/playwright/**',
            ],
        },

    },
    resolve: {
        alias: {
            '@system/api': path.resolve(__dirname, 'packages/api/src'),
            '@system/core': path.resolve(__dirname, 'packages/core/src'),
            '@system/test': path.resolve(__dirname, '.packages/test/src'),
            '@system/worker': path.resolve(__dirname, 'packages/worker/src'),
        },
    }
});
