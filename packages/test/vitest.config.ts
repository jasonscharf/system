import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'jsdom', // for React
        setupFiles: './src/includes.ts',
        include: ['./dist/core/**/*.tests.js'],
    }
});
