/**
 * Vitest global setup — runs before every test file.
 *
 * Polyfills globalThis.WebSocket using the `ws` package so that tests which
 * construct a WebSocket directly (e.g. `new globalThis.WebSocket(url)`) work
 * on Node.js < 22 as well as in CI environments that don't have the native API.
 *
 * WebSocketClient already falls back to `ws` internally, but tests that
 * instantiate globalThis.WebSocket themselves also need this polyfill.
 */
import { WebSocket } from 'ws';

if (typeof globalThis.WebSocket === 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).WebSocket = WebSocket;
}
