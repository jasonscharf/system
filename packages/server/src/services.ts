import { declareService } from "@jasonscharf/core";

/**
 * Container token for the at-rest PII field cipher (IFieldCipher has no
 * runtime identity). Boot binds the real cipher:
 *
 *   bindService(FieldCipherService, await FieldCipher.fromSecrets(secrets));
 *
 * buildServerContext falls back to this binding when the base carries no
 * cipher, so PII encryption is wired by default once boot binds it.
 */
export abstract class FieldCipherService {
    abstract readonly currentKeyId: string;
    abstract encrypt(plaintext: string): { keyId: string; ciphertext: string };
    abstract decrypt(keyId: string, ciphertext: string): string;
    abstract hasKey(keyId: string): boolean;
}

declareService(FieldCipherService);
