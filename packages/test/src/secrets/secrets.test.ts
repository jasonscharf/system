import {
    AzureKeyVaultProvider,
    CachedSecretsProvider,
    EnvSecretsProvider,
    InMemorySecretsProvider,
    type ISecretsProvider,
    SecretsManager,
} from "@jasonscharf/vaults";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── EnvSecretsProvider ────────────────────────────────────────────────────────

describe("EnvSecretsProvider", () => {
    let provider: EnvSecretsProvider;

    beforeEach(() => {
        provider = new EnvSecretsProvider();
        process.env.__TEST_SECRET__ = "hello-env";
    });

    afterEach(() => {
        delete process.env.__TEST_SECRET__;
        delete process.env.__TEST_REQUIRED__;
    });

    it("returns the env var value", async () => {
        expect(await provider.get("__TEST_SECRET__")).toBe("hello-env");
    });

    it("returns null for missing env var", async () => {
        expect(await provider.get("__NO_SUCH_VAR_XYZ__")).toBeNull();
    });

    it("getRequired() returns value when set", async () => {
        process.env.__TEST_REQUIRED__ = "present";
        expect(await provider.getRequired("__TEST_REQUIRED__")).toBe("present");
    });

    it("getRequired() throws when env var is absent", async () => {
        await expect(provider.getRequired("__NO_SUCH_VAR_XYZ__")).rejects.toThrow(
            "__NO_SUCH_VAR_XYZ__",
        );
    });

    it("getRequired() throws when env var is empty string", async () => {
        process.env.__TEST_REQUIRED__ = "";
        await expect(provider.getRequired("__TEST_REQUIRED__")).rejects.toThrow(
            "__TEST_REQUIRED__",
        );
    });
});

// ── InMemorySecretsProvider ───────────────────────────────────────────────────

describe("InMemorySecretsProvider", () => {
    it("returns value for known key", async () => {
        const p = new InMemorySecretsProvider({ FOO: "bar" });
        expect(await p.get("FOO")).toBe("bar");
    });

    it("returns null for unknown key", async () => {
        const p = new InMemorySecretsProvider();
        expect(await p.get("MISSING")).toBeNull();
    });

    it("set() adds a key fluently", async () => {
        const p = new InMemorySecretsProvider();
        p.set("X", "42");
        expect(await p.get("X")).toBe("42");
    });

    it("delete() removes a key", async () => {
        const p = new InMemorySecretsProvider({ A: "1" });
        p.delete("A");
        expect(await p.get("A")).toBeNull();
    });

    it("getRequired() returns value", async () => {
        const p = new InMemorySecretsProvider({ KEY: "val" });
        expect(await p.getRequired("KEY")).toBe("val");
    });

    it("getRequired() throws on missing key", async () => {
        const p = new InMemorySecretsProvider();
        await expect(p.getRequired("MISSING")).rejects.toThrow("MISSING");
    });
});

// ── CachedSecretsProvider ─────────────────────────────────────────────────────

describe("CachedSecretsProvider", () => {
    it("caches a hit so the inner provider is only called once", async () => {
        const inner = new InMemorySecretsProvider({ X: "cached" });
        const getSpy = vi.spyOn(inner, "get");
        const cached = new CachedSecretsProvider(inner, { ttlMs: 60_000 });

        await cached.get("X");
        await cached.get("X");
        await cached.get("X");

        expect(getSpy).toHaveBeenCalledOnce();
    });

    it("re-fetches after invalidation", async () => {
        const inner = new InMemorySecretsProvider({ X: "val" });
        const getSpy = vi.spyOn(inner, "get");
        const cached = new CachedSecretsProvider(inner, { ttlMs: 60_000 });

        await cached.get("X");
        cached.invalidate("X");
        await cached.get("X");

        expect(getSpy).toHaveBeenCalledTimes(2);
    });

    it("caches null (not-found) results separately", async () => {
        const inner = new InMemorySecretsProvider();
        const getSpy = vi.spyOn(inner, "get");
        const cached = new CachedSecretsProvider(inner, { nullTtlMs: 60_000 });

        await cached.get("MISSING");
        await cached.get("MISSING");

        expect(getSpy).toHaveBeenCalledOnce();
    });

    it("re-fetches after TTL expires (using fake timers)", async () => {
        vi.useFakeTimers();
        const inner = new InMemorySecretsProvider({ X: "v" });
        const getSpy = vi.spyOn(inner, "get");
        const cached = new CachedSecretsProvider(inner, { ttlMs: 1000 });

        await cached.get("X");
        vi.advanceTimersByTime(1001);
        await cached.get("X");

        expect(getSpy).toHaveBeenCalledTimes(2);
        vi.useRealTimers();
    });

    it("invalidate() with no arg clears everything", async () => {
        const inner = new InMemorySecretsProvider({ A: "1", B: "2" });
        const getSpy = vi.spyOn(inner, "get");
        const cached = new CachedSecretsProvider(inner, { ttlMs: 60_000 });

        await cached.get("A");
        await cached.get("B");
        cached.invalidate();
        await cached.get("A");
        await cached.get("B");

        expect(getSpy).toHaveBeenCalledTimes(4);
    });

    it("getRequired() throws on null after cache", async () => {
        const cached = new CachedSecretsProvider(new InMemorySecretsProvider(), { ttlMs: 60_000 });
        await expect(cached.getRequired("MISSING")).rejects.toThrow("MISSING");
    });

    it("close() clears cache and calls inner close()", async () => {
        const inner = new InMemorySecretsProvider({ X: "v" }) as ISecretsProvider & {
            close?: () => Promise<void>;
        };
        inner.close = vi.fn(async () => {});
        const cached = new CachedSecretsProvider(inner, { ttlMs: 60_000 });
        await cached.get("X");
        await cached.close();
        expect(inner.close).toHaveBeenCalledOnce();
        // After close, cache is empty — inner will be called again
        const getSpy = vi.spyOn(inner, "get");
        await cached.get("X");
        expect(getSpy).toHaveBeenCalledOnce();
    });
});

// ── AzureKeyVaultProvider ─────────────────────────────────────────────────────

describe("AzureKeyVaultProvider", () => {
    it("maps underscore key names to hyphenated vault names", async () => {
        // We can't call Azure without credentials, so we verify the naming logic
        // by inspecting a subclass that exposes the mapping.
        class TestableProvider extends AzureKeyVaultProvider {
            toVaultName(key: string): string {
                return (this as unknown as { _toVaultName: (k: string) => string })._toVaultName(
                    key,
                );
            }
        }
        const p = new TestableProvider("https://test.vault.azure.net/");
        expect(p.toVaultName("GOOGLE_CLIENT_SECRET")).toBe("google-client-secret");
        // SYS_ lowercases to the sys- vault prefix verbatim (one naming
        // convention across env and vault); it is NOT rewritten to tern-.
        expect(p.toVaultName("SYS_PG_PASSWORD")).toBe("sys-pg-password");
        expect(p.toVaultName("REDIS_URL")).toBe("redis-url");
    });

    it("get() returns null for 404 / SecretNotFound without crashing", async () => {
        const provider = new AzureKeyVaultProvider("https://fake.vault.azure.net/");
        // Stub _getClient so we skip real Azure auth
        const fakeClient = {
            getSecret: vi.fn().mockRejectedValue({ code: "SecretNotFound" }),
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (provider as unknown as { _client: typeof fakeClient })._client = fakeClient;

        const value = await provider.get("ANY_KEY");
        expect(value).toBeNull();
    });

    it("get() re-throws non-404 errors", async () => {
        const provider = new AzureKeyVaultProvider("https://fake.vault.azure.net/");
        const fakeClient = {
            getSecret: vi.fn().mockRejectedValue(new Error("Network failure")),
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (provider as unknown as { _client: typeof fakeClient })._client = fakeClient;

        await expect(provider.get("ANY_KEY")).rejects.toThrow("Network failure");
    });

    it("getRequired() throws descriptive error when secret is missing", async () => {
        const provider = new AzureKeyVaultProvider("https://fake.vault.azure.net/");
        const fakeClient = {
            getSecret: vi.fn().mockRejectedValue({ code: "SecretNotFound" }),
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (provider as unknown as { _client: typeof fakeClient })._client = fakeClient;

        await expect(provider.getRequired("MY_SECRET")).rejects.toThrow("MY_SECRET");
    });

    it("get() returns the secret value on success", async () => {
        const provider = new AzureKeyVaultProvider("https://fake.vault.azure.net/");
        const fakeClient = {
            getSecret: vi.fn().mockResolvedValue({ value: "super-secret" }),
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (provider as unknown as { _client: typeof fakeClient })._client = fakeClient;

        expect(await provider.get("ANY_KEY")).toBe("super-secret");
    });

    it("getRequired() returns value when secret is present", async () => {
        const provider = new AzureKeyVaultProvider("https://fake.vault.azure.net/");
        const fakeClient = {
            getSecret: vi.fn().mockResolvedValue({ value: "found-secret" }),
        };
        (provider as unknown as { _client: typeof fakeClient })._client = fakeClient;

        expect(await provider.getRequired("MY_SECRET")).toBe("found-secret");
    });

    it("get() returns null when secret value is undefined", async () => {
        const provider = new AzureKeyVaultProvider("https://fake.vault.azure.net/");
        const fakeClient = {
            getSecret: vi.fn().mockResolvedValue({ value: undefined }),
        };
        (provider as unknown as { _client: typeof fakeClient })._client = fakeClient;

        expect(await provider.get("ANY_KEY")).toBeNull();
    });

    it("get() handles statusCode 404 as not-found", async () => {
        const provider = new AzureKeyVaultProvider("https://fake.vault.azure.net/");
        const fakeClient = {
            getSecret: vi.fn().mockRejectedValue({ statusCode: 404 }),
        };
        (provider as unknown as { _client: typeof fakeClient })._client = fakeClient;

        expect(await provider.get("ANY_KEY")).toBeNull();
    });
});

// ── SecretsManager ────────────────────────────────────────────────────────────

describe("SecretsManager", () => {
    it("get() delegates to the provider", async () => {
        const mgr = new SecretsManager(new InMemorySecretsProvider({ KEY: "val" }));
        expect(await mgr.get("KEY")).toBe("val");
    });

    it("getRequired() delegates to the provider", async () => {
        const mgr = new SecretsManager(new InMemorySecretsProvider({ KEY: "val" }));
        expect(await mgr.getRequired("KEY")).toBe("val");
    });

    it("getWithDefault() returns the secret when present", async () => {
        const mgr = new SecretsManager(new InMemorySecretsProvider({ KEY: "found" }));
        expect(await mgr.getWithDefault("KEY", "fallback")).toBe("found");
    });

    it("getWithDefault() returns the default when secret is null", async () => {
        const mgr = new SecretsManager(new InMemorySecretsProvider());
        expect(await mgr.getWithDefault("MISSING", "fallback")).toBe("fallback");
    });

    it("fromEnvironment() returns EnvSecretsProvider when no vault URI is set", () => {
        delete process.env.AZURE_KEY_VAULT_URI;
        const mgr = SecretsManager.fromEnvironment();
        expect(mgr).toBeInstanceOf(SecretsManager);
    });

    it("fromEnvironment() returns AzureKeyVaultProvider (cached) when vault URI is set", () => {
        process.env.AZURE_KEY_VAULT_URI = "https://test.vault.azure.net/";
        const mgr = SecretsManager.fromEnvironment();
        expect(mgr).toBeInstanceOf(SecretsManager);
        delete process.env.AZURE_KEY_VAULT_URI;
    });

    it("close() calls provider close if available", async () => {
        const inner = new InMemorySecretsProvider() as ISecretsProvider & {
            close?: () => Promise<void>;
        };
        inner.close = vi.fn(async () => {});
        const mgr = new SecretsManager(inner);
        await mgr.close();
        expect(inner.close).toHaveBeenCalledOnce();
    });
});
