/**
 * Computes the Shannon Entropy of an array of unsigned 8-bit integers.
 * @param data
 * @returns A value between 0 and 8 indicating the Shannon Entropy.
 */
export function shannonEntropy(data: Uint8Array): number {
    if (data.length === 0) {
        return 0;
    }

    const freq = new Uint32Array(256);
    for (const b of data) {
        freq[b]++;
    }

    let entropy = 0;
    const n = data.length;

    for (const c of freq) {
        if (c === 0) {
            continue;
        }
        const p = c / n;
        entropy -= p * Math.log2(p);
    }

    return entropy;
}

/**
 * Isomorphic random UInt8Array.
 * Works in Node 18+ and supported browsers.
 * @param length
 * @returns
 */
export function randomUInt8Array(length: number): Uint8Array {
    const arr = new Uint8Array(length);
    globalThis.crypto.getRandomValues(arr);
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
