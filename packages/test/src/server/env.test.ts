import {
    copyEnvBlock,
    env,
    isDev,
    isProduction,
    isStaging,
    isStagingDev,
    isStagingOrProduction,
    isTest,
} from "@jasonscharf/server";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("env mode predicates", () => {
    let original: string;

    beforeEach(() => {
        original = env.SYS_MODE;
    });

    afterEach(() => {
        env.SYS_MODE = original;
    });

    it("isDev is true only in dev mode", () => {
        env.SYS_MODE = "dev";
        expect(isDev()).toBe(true);
    });

    it("isDev is false in staging", () => {
        env.SYS_MODE = "staging";
        expect(isDev()).toBe(false);
    });

    it("isDev is false in production", () => {
        env.SYS_MODE = "production";
        expect(isDev()).toBe(false);
    });

    it("isDev is false in test", () => {
        env.SYS_MODE = "test";
        expect(isDev()).toBe(false);
    });

    it("isTest keys off the real mode and ignores the removed PRIMO_MODE", () => {
        env.SYS_MODE = "test";
        expect(isTest()).toBe(true);

        env.SYS_MODE = "dev";
        expect(isTest()).toBe(false);
    });

    it("isStaging is true only in staging", () => {
        env.SYS_MODE = "staging";
        expect(isStaging()).toBe(true);
        expect(isStagingOrProduction()).toBe(true);

        env.SYS_MODE = "production";
        expect(isStaging()).toBe(false);
    });

    it("isProduction is true only in production", () => {
        env.SYS_MODE = "production";
        expect(isProduction()).toBe(true);
        expect(isStagingOrProduction()).toBe(true);

        env.SYS_MODE = "dev";
        expect(isProduction()).toBe(false);
        expect(isStagingOrProduction()).toBe(false);
    });

    it("isStagingDev is true only in staging-dev", () => {
        env.SYS_MODE = "staging-dev";
        expect(isStagingDev()).toBe(true);

        env.SYS_MODE = "dev";
        expect(isStagingDev()).toBe(false);
    });

    it("the mode predicates are mutually exclusive across modes", () => {
        env.SYS_MODE = "staging";
        expect(isDev()).toBe(false);
        expect(isTest()).toBe(false);
        expect(isProduction()).toBe(false);
    });
});

describe("copyEnvBlock", () => {
    it("copies source values over matching target keys", () => {
        const target: Record<string, string | null | undefined> = {
            A: "default-a",
            B: "default-b",
        };
        copyEnvBlock({ A: "from-source", B: "also-source" }, target);
        expect(target).toStrictEqual({ A: "from-source", B: "also-source" });
    });

    it("preserves the target default when the source value is absent", () => {
        const target: Record<string, string | null | undefined> = {
            A: "default-a",
            B: "default-b",
        };
        copyEnvBlock({ A: "from-source" } as Record<string, string>, target);
        expect(target.A).toBe("from-source");
        expect(target.B).toBe("default-b");
    });

    it("only copies keys already present in the target", () => {
        const target: Record<string, string | null | undefined> = { A: "default-a" };
        copyEnvBlock({ A: "from-source", EXTRA: "ignored" }, target);
        expect(target).toStrictEqual({ A: "from-source" });
        expect("EXTRA" in target).toBe(false);
    });
});
