/**
 * Isomorphic random UInt8Array.
 * Works in Node 18+ and supported browsers.
 * @param length 
 * @returns 
 */
export function randomUInt8Array(length: number): Uint8Array {
    // Browser / Deno / Bun (Web Crypto API)
    if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.getRandomValues === "function") {
        const arr = new Uint8Array(length);
        globalThis.crypto.getRandomValues(arr);
        return arr;
    }

    // Node.js (ESM)
    if (typeof process !== "undefined" && process.versions?.node) {
        // Lazy ESM import to avoid bundling Node crypto in browsers
        const crypto = require("crypto");
        return new Uint8Array(crypto.randomBytes(length));
    }

    // Fallback (non-secure)
    const arr = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        arr[i] = Math.floor(Math.random() * 256);
    }
    return arr;
}

/**
 * Computes a binary UUIDv4.
 * @returns 
 */
export function uuidv4Binary(): Uint8Array {
    const bytes = randomUInt8Array(16);

    // Set version to 4 → bits 12-15 of 7th byte
    bytes[6] = (bytes[6] & 0x0f) | 0x40;

    // Set variant → bits 6-7 of 9th byte
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    return bytes;
}
