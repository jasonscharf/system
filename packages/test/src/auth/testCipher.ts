import { FieldCipher } from "@jasonscharf/vaults";

/**
 * A deterministic field cipher for auth tests.  The User and UserIdentity repos
 * carry PII properties (displayName / avatarUrl / accessToken / refreshToken)
 * that EntityStore encrypts at rest; with no cipher available it fails closed
 * and throws.  Tests construct those two repos with this cipher so PII writes
 * round-trip.  The key is a fixed test value — never use it outside tests.
 */
export const TEST_CIPHER = new FieldCipher({
    keys: { test: Buffer.alloc(32, 7) },
    currentKeyId: "test",
});
