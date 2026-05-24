import {
    deepFreeze,
    exists,
    flush,
    randomUInt8Array,
    repeat,
    shannonEntropy,
    sleep,
    uint8ToHex,
    uuidToHex,
    uuidv4Binary,
} from "@jasonscharf/core";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe(deepFreeze, () => {
    let obj: { a: { b: { c: object } } };
    beforeEach(() => (obj = { a: { b: { c: {} } } }));

    it("freezes nested objects", () => {
        const froze = deepFreeze(obj);
        expect(Object.isFrozen(froze)).toBe(true);
        expect(froze).toStrictEqual({ a: { b: { c: {} } } });
        expect(Object.isFrozen(froze.a)).toBe(true);
        expect(Object.isFrozen(froze.a.b)).toBe(true);
        expect(Object.isFrozen(froze.a.b.c)).toBe(true);
    });

    it("handles cycles", () => {
        obj.a.b.c = obj;
        const froze = deepFreeze(obj);
        expect(Object.isFrozen(froze.a.b.c)).toBe(true);
    });

    it("returns null or undefined when supplied null or undefined", () => {
        expect(deepFreeze(null)).to.eq(null);
        expect(deepFreeze(undefined)).to.eq(undefined);
    });

    it("throws on attempted mutation", () => {
        const foo = { a: { b: { num: 5, str: "banana", c: { d: 6 } } } };
        const froze = deepFreeze(foo);
        const any = froze as unknown as Record<string, Record<string, unknown>>;
        expect(() => (any.a = {})).toThrow();
        expect(() => (any.b = {})).toThrow();
        expect(() => {
            any.b.num = 6;
        }).toThrow();
        expect(() => {
            any.b.str = "toboggan";
        }).toThrow();
        expect(() => {
            any.b.d = {};
        }).toThrow();
    });
});

describe(exists, () => {
    it("returns false for null", () => expect(exists(null)).toStrictEqual(false));
    it("returns false for undefined", () => expect(exists(undefined)).toStrictEqual(false));
    it("returns true for an empty string", () => expect(exists("")).toStrictEqual(true));
    it("returns true for 0", () => expect(exists(0)).toStrictEqual(true));
    it("returns true for NaN", async () => expect(exists(NaN)).toStrictEqual(true));
    it("returns true for sclar", async () => expect(exists(5)).toStrictEqual(true));
});

describe("async", () => {
    beforeEach(vi.useFakeTimers);
    describe(repeat, () => {
        it("runs the callback multiple times", async () => {
            const spy = vi.fn();
            repeat(1000, spy);

            vi.advanceTimersByTime(1000);
            await flush();
            expect(spy).to.toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(1000);
            await flush();
            expect(spy).to.toHaveBeenCalledTimes(2);

            vi.advanceTimersByTime(1000);
            await flush();
            expect(spy).to.toHaveBeenCalledTimes(3);
        });

        it("can be cancelled", async () => {
            const spy = vi.fn();
            const p = repeat(1000, spy);

            vi.advanceTimersByTime(1000);
            await flush();
            expect(spy).to.toHaveBeenCalledTimes(1);

            clearInterval(p);
            await flush();
            expect(spy).to.toHaveBeenCalledTimes(1);
        });
    });
    describe(sleep, () => {
        it("executes the callback", async () => {
            const spy = vi.fn();
            sleep(1000).then(spy);

            vi.advanceTimersByTime(999);
            expect(spy).not.toHaveBeenCalled();

            // Finish the sleep
            vi.advanceTimersByTime(1);
            await flush();
            await flush();

            expect(spy).toHaveBeenCalledOnce();
        });
    });
    afterEach(vi.useRealTimers);
});

describe("binary", () => {
    describe(uint8ToHex, () => {
        it("produces lowercase hex", () => {
            const hex = uint8ToHex(new Uint8Array([0xfe, 0xff]));
            expect(hex).to.eq("feff");
        });
    });

    describe(uuidToHex, () => {
        it("converts 16-byte UUID to a 32-char hex string", () => {
            const uuid = uuidv4Binary();
            const hex = uuidToHex(uuid);
            expect(hex.length).toBe(32);
            expect(/^[0-9a-f]+$/.test(hex)).toBe(true);
        });
    });
});

describe("random", () => {
    describe(randomUInt8Array, () => {
        it("produces an array with the supplied length", () => {
            const random = randomUInt8Array(32);
            expect(random.length).to.eq(32);
            expect(typeof random[0] === "number");
        });
    });

    describe(shannonEntropy, () => {
        it("returns 0 for empty array", () => {
            const result = shannonEntropy(new Uint8Array([]));
            expect(result).to.eq(0);
        });

        it("correctly computes 0 entropy", () => {
            const data = [0x00];
            const ent = shannonEntropy(new Uint8Array(data));
            expect(ent).to.eq(0);
        });

        it("correctly computes high entropy", () => {
            const data = randomUInt8Array(4096);
            const ent = shannonEntropy(data);
            expect(ent).to.be.greaterThan(7);
            expect(ent).to.be.lessThan(8);
        });
    });

    describe(uuidv4Binary, () => {
        it("has correct length", () => {
            const uuid = uuidv4Binary();
            expect(uuid).toBeInstanceOf(Uint8Array);
            expect(uuid.length).toBe(16);
        });

        it("sets version to 4 (0100) in byte 6", () => {
            const uuid = uuidv4Binary();
            const versionByte = uuid[6];
            const version = versionByte >> 4;
            expect(version).toBe(4);
        });

        it("sets variant to 10xx in byte 8", () => {
            const uuid = uuidv4Binary();
            const variantByte = uuid[8];
            const topBits = variantByte >> 6;
            expect(topBits).toBe(0b10);
        });

        it("generates unique values", () => {
            const a = uuidv4Binary();
            const b = uuidv4Binary();
            expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
        });
    });
});
