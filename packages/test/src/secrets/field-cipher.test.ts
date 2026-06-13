import { randomBytes } from "node:crypto";
import { FieldCipher, InMemorySecretsProvider, SecretsManager } from "@jasonscharf/vaults";
import { describe, expect, it } from "vitest";

function key(): string {
    return randomBytes(32).toString("base64");
}

function cipher(): FieldCipher {
    return new FieldCipher({ keys: { k1: key() }, currentKeyId: "k1" });
}

describe("FieldCipher", () => {
    it("round-trips a value", () => {
        const c = cipher();
        const enc = c.encrypt("hunter2");
        expect(c.decrypt(enc.keyId, enc.ciphertext)).toBe("hunter2");
    });

    it("tags ciphertext with the current key id", () => {
        const c = cipher();
        expect(c.encrypt("x").keyId).toBe("k1");
        expect(c.currentKeyId).toBe("k1");
    });

    it("is deterministic — equal plaintext yields identical ciphertext (preserves interning)", () => {
        const c = cipher();
        expect(c.encrypt("alice@example.com").ciphertext).toBe(
            c.encrypt("alice@example.com").ciphertext,
        );
    });

    it("is deterministic across instances sharing the same key", () => {
        const shared = key();
        const a = new FieldCipher({ keys: { k1: shared }, currentKeyId: "k1" });
        const b = new FieldCipher({ keys: { k1: shared }, currentKeyId: "k1" });
        expect(a.encrypt("same").ciphertext).toBe(b.encrypt("same").ciphertext);
    });

    it("produces different ciphertext for different plaintext", () => {
        const c = cipher();
        expect(c.encrypt("a").ciphertext).not.toBe(c.encrypt("b").ciphertext);
    });

    it("round-trips unicode and empty strings", () => {
        const c = cipher();
        for (const v of ["", "ünïcödé 🔐", "a".repeat(10_000)]) {
            const enc = c.encrypt(v);
            expect(c.decrypt(enc.keyId, enc.ciphertext)).toBe(v);
        }
    });

    it("rejects a tampered ciphertext body (auth tag fails)", () => {
        const c = cipher();
        const enc = c.encrypt("secret");
        const raw = Buffer.from(enc.ciphertext.slice("v1:".length), "base64");
        raw[raw.length - 1] ^= 0x01; // flip a tag bit
        const tampered = `v1:${raw.toString("base64")}`;
        expect(() => c.decrypt(enc.keyId, tampered)).toThrow();
    });

    it("fails to decrypt with the wrong key", () => {
        const a = new FieldCipher({ keys: { k1: key() }, currentKeyId: "k1" });
        const b = new FieldCipher({ keys: { k1: key() }, currentKeyId: "k1" });
        const enc = a.encrypt("secret");
        expect(() => b.decrypt(enc.keyId, enc.ciphertext)).toThrow();
    });

    it("throws on an unknown key id", () => {
        const c = cipher();
        const enc = c.encrypt("x");
        expect(() => c.decrypt("nope", enc.ciphertext)).toThrow(/unknown keyId/);
    });

    it("rejects a malformed or wrong-version envelope", () => {
        const c = cipher();
        expect(() => c.decrypt("k1", "no-prefix")).toThrow();
        expect(() => c.decrypt("k1", "v9:AAAA")).toThrow(/version/);
    });

    it("supports key rotation — old keys still decrypt after the current key changes", () => {
        const k1 = key();
        const k2 = key();
        const old = new FieldCipher({ keys: { k1 }, currentKeyId: "k1" });
        const enc = old.encrypt("legacy");

        const rotated = new FieldCipher({ keys: { k1, k2 }, currentKeyId: "k2" });
        expect(rotated.currentKeyId).toBe("k2");
        expect(rotated.decrypt(enc.keyId, enc.ciphertext)).toBe("legacy");
        expect(rotated.encrypt("fresh").keyId).toBe("k2");
    });

    it("rejects keys that are not 32 bytes", () => {
        expect(
            () =>
                new FieldCipher({
                    keys: { k1: randomBytes(16).toString("base64") },
                    currentKeyId: "k1",
                }),
        ).toThrow(/32 bytes/);
    });

    it("rejects a currentKeyId missing from the ring", () => {
        expect(() => new FieldCipher({ keys: { k1: key() }, currentKeyId: "k9" })).toThrow(
            /not present/,
        );
    });

    it("reports key availability via hasKey", () => {
        const c = cipher();
        expect(c.hasKey("k1")).toBe(true);
        expect(c.hasKey("k2")).toBe(false);
    });

    it("builds from the SecretsManager keyring", async () => {
        const k1 = key();
        const secrets = new SecretsManager(
            new InMemorySecretsProvider({
                SYS_FIELD_ENC_KEYS: JSON.stringify({ k1 }),
                SYS_FIELD_ENC_CURRENT: "k1",
            }),
        );
        const c = await FieldCipher.fromSecrets(secrets);
        const enc = c.encrypt("from-vault");
        expect(c.decrypt(enc.keyId, enc.ciphertext)).toBe("from-vault");
    });

    it("fromSecrets throws when the keyring secret is absent", async () => {
        const secrets = new SecretsManager(new InMemorySecretsProvider({}));
        await expect(FieldCipher.fromSecrets(secrets)).rejects.toThrow();
    });
});
