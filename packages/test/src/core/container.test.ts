import { ServiceContainer, ServiceToken } from "@jasonscharf/core";
import { describe, expect, it } from "vitest";

interface ICounter {
    increment(): void;
    value(): number;
}

interface IGreeter {
    greet(name: string): string;
}

const CounterToken = new ServiceToken<ICounter>("Counter");
const GreeterToken = new ServiceToken<IGreeter>("Greeter");

describe("ServiceToken", () => {
    it("test token has name", () => {
        expect(CounterToken.name).toBe("Counter");
    });

    it("test token to string", () => {
        expect(String(CounterToken)).toBe("ServiceToken(Counter)");
    });

    it("test tokens with same name are distinct", () => {
        const a = new ServiceToken<string>("foo");
        const b = new ServiceToken<string>("foo");
        expect(a.key).not.toBe(b.key);
    });
});

describe("ServiceContainer", () => {
    it("test resolves bound service", () => {
        let count = 0;
        const counter: ICounter = { increment: () => { count++; }, value: () => count };
        const container = new ServiceContainer();
        container.bind(CounterToken, counter);
        const resolved = container.resolve(CounterToken);
        resolved.increment();
        expect(count).toBe(1);
    });

    it("test resolve throws for unregistered token", () => {
        const container = new ServiceContainer();
        expect(() => container.resolve(CounterToken)).toThrow("Service not registered: ServiceToken(Counter)");
    });

    it("test try resolve returns undefined for unregistered", () => {
        const container = new ServiceContainer();
        expect(container.tryResolve(CounterToken)).toBeUndefined();
    });

    it("test try resolve returns instance when bound", () => {
        let count = 0;
        const counter: ICounter = { increment: () => { count++; }, value: () => count };
        const container = new ServiceContainer();
        container.bind(CounterToken, counter);
        expect(container.tryResolve(CounterToken)).toBe(counter);
    });

    it("test has returns false before bind", () => {
        const container = new ServiceContainer();
        expect(container.has(CounterToken)).toBe(false);
    });

    it("test has returns true after bind", () => {
        const counter: ICounter = { increment: () => {}, value: () => 0 };
        const container = new ServiceContainer();
        container.bind(CounterToken, counter);
        expect(container.has(CounterToken)).toBe(true);
    });

    it("test multiple services are independent", () => {
        let count = 0;
        const counter: ICounter = { increment: () => { count++; }, value: () => count };
        const greeter: IGreeter = { greet: (name) => `Hello, ${name}!` };

        const container = new ServiceContainer();
        container.bind(CounterToken, counter);
        container.bind(GreeterToken, greeter);

        expect(container.resolve(CounterToken)).toBe(counter);
        expect(container.resolve(GreeterToken)).toBe(greeter);
        expect(container.resolve(GreeterToken).greet("World")).toBe("Hello, World!");
    });

    it("test bind returns container for chaining", () => {
        const counter: ICounter = { increment: () => {}, value: () => 0 };
        const greeter: IGreeter = { greet: () => "" };
        const container = new ServiceContainer();
        const result = container.bind(CounterToken, counter).bind(GreeterToken, greeter);
        expect(result).toBe(container);
    });

    it("test rebind overwrites previous service", () => {
        const first: ICounter = { increment: () => {}, value: () => 1 };
        const second: ICounter = { increment: () => {}, value: () => 2 };
        const container = new ServiceContainer();
        container.bind(CounterToken, first);
        container.bind(CounterToken, second);
        expect(container.resolve(CounterToken).value()).toBe(2);
    });

    it("test distinct tokens with same name are independent", () => {
        const t1 = new ServiceToken<string>("shared");
        const t2 = new ServiceToken<string>("shared");
        const container = new ServiceContainer();
        container.bind(t1, "first");
        container.bind(t2, "second");
        expect(container.resolve(t1)).toBe("first");
        expect(container.resolve(t2)).toBe("second");
    });
});
