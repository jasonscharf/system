/**
 * Converts a byte array to hex.
 * @param bytes
 * @returns
 */
export function uint8ToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}
