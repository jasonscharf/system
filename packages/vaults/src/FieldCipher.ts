import { createCipheriv, createDecipheriv, createHmac, hkdfSync } from "node:crypto";
import type { SecretsManager } from "./SecretsManager.js";

const VERSION = "v1";
const KEY_BYTES = 32; // AES-256
const NONCE_BYTES = 12; // GCM standard nonce length
const TAG_BYTES = 16; // GCM auth tag length

/** Default secret names the SecretsManager factory reads from. */
export const FIELD_ENC_KEYS_VAR = "SYS_FIELD_ENC_KEYS";
export const FIELD_ENC_CURRENT_VAR = "SYS_FIELD_ENC_CURRENT";

/** A stored ciphertext together with the id of the key that produced it. */
export interface CipherText {
    /** Id of the key used to encrypt — persisted alongside the value for rotation. */
    keyId: string;
    /** Version-prefixed base64 envelope: `v1:base64(nonce|ciphertext|tag)`. */
    ciphertext: string;
}

export interface FieldCipherOptions {
    /** keyId -> 32-byte key (raw Buffer or base64 string). */
    keys: Record<string, Buffer | string>;
    /** Which key new values are encrypted under. Must exist in `keys`. */
    currentKeyId: string;
}

/**
 * Deterministic authenticated field encryption for at-rest PII.
 *
 * Uses an SIV-style construction: the GCM nonce is derived deterministically as
 * HMAC(macKey, plaintext), so identical plaintext under the same key always
 * yields identical ciphertext. That is the property the triple store needs —
 * literal nodes are interned and matched by equality, and randomized IVs would
 * break both dedup and `find({ object })` lookups. The cost is that value
 * equality leaks (equal plaintext ⇒ equal ciphertext); for a graph store keyed
 * on term identity that is the right trade. Range / substring queries over
 * encrypted values are not possible and must be rejected by the query layer.
 *
 * Encryption and MAC subkeys are HKDF-derived from the master key so the raw
 * key is never used directly. Keys are addressed by id and the id is stored
 * with each value, so keys rotate without rewriting old rows: add a new current
 * key, keep old keys in the ring for decrypt, re-encrypt lazily or via a job.
 */
export class FieldCipher {
    private readonly _keys: Map<string, Buffer>;
    private readonly _currentKeyId: string;

    constructor(options: FieldCipherOptions) {
        this._keys = new Map();
        for (const [id, raw] of Object.entries(options.keys)) {
            const buf = typeof raw === "string" ? Buffer.from(raw, "base64") : raw;
            if (buf.length !== KEY_BYTES) {
                throw new Error(
                    `FieldCipher: key "${id}" must be ${KEY_BYTES} bytes, got ${buf.length}`,
                );
            }
            this._keys.set(id, buf);
        }
        if (!this._keys.has(options.currentKeyId)) {
            throw new Error(
                `FieldCipher: currentKeyId "${options.currentKeyId}" is not present in the keyring`,
            );
        }
        this._currentKeyId = options.currentKeyId;
    }

    /** The key id new values are encrypted under. */
    get currentKeyId(): string {
        return this._currentKeyId;
    }

    /** Encrypt a value under the current key. Deterministic for equal plaintext. */
    encrypt(plaintext: string): CipherText {
        const { encKey, macKey } = this._subkeys(this._key(this._currentKeyId));
        const pt = Buffer.from(plaintext, "utf8");
        // Synthetic IV: deterministic nonce ⇒ deterministic ciphertext (preserves interning).
        const nonce = createHmac("sha256", macKey).update(pt).digest().subarray(0, NONCE_BYTES);
        const cipher = createCipheriv("aes-256-gcm", encKey, nonce);
        const body = Buffer.concat([cipher.update(pt), cipher.final()]);
        const tag = cipher.getAuthTag();
        const envelope = Buffer.concat([nonce, body, tag]).toString("base64");
        return { keyId: this._currentKeyId, ciphertext: `${VERSION}:${envelope}` };
    }

    /** Decrypt a value previously produced by `encrypt`, verifying its auth tag. */
    decrypt(keyId: string, ciphertext: string): string {
        const { encKey } = this._subkeys(this._key(keyId));
        const [version, envelope] = this._split(ciphertext);
        if (version !== VERSION) {
            throw new Error(`FieldCipher: unsupported ciphertext version "${version}"`);
        }
        const raw = Buffer.from(envelope, "base64");
        if (raw.length < NONCE_BYTES + TAG_BYTES) {
            throw new Error("FieldCipher: ciphertext envelope is too short to be valid");
        }
        const nonce = raw.subarray(0, NONCE_BYTES);
        const tag = raw.subarray(raw.length - TAG_BYTES);
        const body = raw.subarray(NONCE_BYTES, raw.length - TAG_BYTES);
        const decipher = createDecipheriv("aes-256-gcm", encKey, nonce);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    }

    /** True when a key with this id is available for decryption. */
    hasKey(keyId: string): boolean {
        return this._keys.has(keyId);
    }

    /**
     * Build a cipher from the SecretsManager. Reads a JSON keyId->base64-key map
     * from `SYS_FIELD_ENC_KEYS` and the active key id from `SYS_FIELD_ENC_CURRENT`.
     */
    static async fromSecrets(
        secrets: SecretsManager,
        options?: { keysVar?: string; currentVar?: string },
    ): Promise<FieldCipher> {
        const keysVar = options?.keysVar ?? FIELD_ENC_KEYS_VAR;
        const currentVar = options?.currentVar ?? FIELD_ENC_CURRENT_VAR;
        const keysJson = await secrets.getRequired(keysVar);
        const currentKeyId = await secrets.getRequired(currentVar);
        let keys: Record<string, string>;
        try {
            keys = JSON.parse(keysJson) as Record<string, string>;
        } catch {
            throw new Error(`FieldCipher: ${keysVar} must be a JSON object of keyId -> base64 key`);
        }
        return new FieldCipher({ keys, currentKeyId });
    }

    private _split(ciphertext: string): [string, string] {
        const idx = ciphertext.indexOf(":");
        if (idx < 0) {
            throw new Error("FieldCipher: malformed ciphertext (missing version prefix)");
        }
        return [ciphertext.slice(0, idx), ciphertext.slice(idx + 1)];
    }

    private _key(keyId: string): Buffer {
        const key = this._keys.get(keyId);
        if (!key) {
            throw new Error(`FieldCipher: unknown keyId "${keyId}"`);
        }
        return key;
    }

    private _subkeys(key: Buffer): { encKey: Buffer; macKey: Buffer } {
        return {
            encKey: Buffer.from(
                hkdfSync("sha256", key, Buffer.alloc(0), "tern:field:enc", KEY_BYTES),
            ),
            macKey: Buffer.from(
                hkdfSync("sha256", key, Buffer.alloc(0), "tern:field:mac", KEY_BYTES),
            ),
        };
    }
}
