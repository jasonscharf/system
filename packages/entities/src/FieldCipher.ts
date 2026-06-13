/**
 * Minimal cipher contract the entity layer needs to encrypt PII at rest.
 *
 * The concrete deterministic AEAD implementation lives in `@jasonscharf/vaults`
 * (`FieldCipher`).  This interface is declared here so the entity / server layer
 * can depend on the capability without depending on the vaults package — the app
 * builds the real cipher at startup (where vaults is available) and threads it
 * into the EntityStore / ServerContext.  Structural typing means the concrete
 * FieldCipher satisfies this contract with no adapter.
 */
export interface IFieldCipher {
    /** The key id new values are encrypted under. Stored alongside ciphertext for rotation. */
    readonly currentKeyId: string;
    /** Encrypt a plaintext value under the current key. Deterministic for equal plaintext. */
    encrypt(plaintext: string): { keyId: string; ciphertext: string };
    /** Decrypt a value previously produced by encrypt(), verifying its auth tag. */
    decrypt(keyId: string, ciphertext: string): string;
    /** True when a key with this id is available for decryption. */
    hasKey(keyId: string): boolean;
}
