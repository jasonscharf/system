import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
    },
    build: {
        rollupOptions: {
            // `ws` is the Node.js WebSocket package used by WebSocketClient as a
            // fallback when globalThis.WebSocket is absent (Node < 22).
            // Browsers always have native WebSocket, so this path is never executed
            // but without marking `ws` external Rollup would still try to bundle it.
            external: ["ws"],
        },
    },
});
