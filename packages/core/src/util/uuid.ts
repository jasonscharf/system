import { uint8ToHex } from "./binary.js";

/**
 * Converts a 16-byte UUID to hex.
 * Note that this is for display purposes only.
 * Internally, binary v4 UUIDs are used exclusively as non-semantic identifiers.
 * @param bytes
 * @returns
 */
export function uuidToHex(bytes: Uint8Array): string {
    return uint8ToHex(bytes);
}
