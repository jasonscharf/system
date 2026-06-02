import type { ServiceToken } from "./ServiceToken.js";

/**
 * A lightweight, synchronous IoC container keyed by ServiceToken<T>.
 *
 * Services are bound by token and resolved by token.  Two tokens with the same
 * name are always independent because tokens are Symbol-keyed internally.
 * All type information flows through the token's phantom type parameter.
 */
export class ServiceContainer {
    private readonly _services = new Map<symbol, unknown>();

    bind<T>(token: ServiceToken<T>, instance: T): this {
        this._services.set(token.key, instance);
        return this;
    }

    resolve<T>(token: ServiceToken<T>): T {
        if (!this._services.has(token.key)) {
            throw new Error(`Service not registered: ${token}`);
        }
        return this._services.get(token.key) as T;
    }

    tryResolve<T>(token: ServiceToken<T>): T | undefined {
        return this._services.get(token.key) as T | undefined;
    }

    has<T>(token: ServiceToken<T>): boolean {
        return this._services.has(token.key);
    }
}
