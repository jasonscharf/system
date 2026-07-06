import { Container, Scope } from "typescript-ioc";

/**
 * The platform IoC container (typescript-ioc), re-exported so every package —
 * inside this repo and downstream consumers — resolves the exact same module
 * instance. Import Container from "@jasonscharf/core", never from
 * "typescript-ioc" directly: a second copy of the library is a second,
 * disconnected container, and overrides bound to one are invisible to the
 * other.
 *
 * Override pattern for consumers: import the container and bind before the
 * first context is created —
 *
 *   import { bindService, SystemBus } from "@jasonscharf/core";
 *   bindService(SystemBus, myBus);
 *
 * Every context built afterwards (buildServerContext, defaultCtx reads) sees
 * the override.
 */
export { Container, Scope };

/**
 * A class object usable as a container token. Abstract classes are the
 * canonical tokens for interface-shaped services (interfaces have no runtime
 * identity); concrete service classes act as their own token.
 */
export type ServiceIdentity<T> = abstract new (...args: never[]) => T;

/** Thrown when a declared service is resolved before an implementation is bound. */
export class ServiceNotBoundError extends Error {
    constructor(tokenName: string) {
        super(
            `No implementation bound for service "${tokenName}". ` +
                `Bind one at boot: bindService(${tokenName}, instance).`,
        );
        this.name = "ServiceNotBoundError";
    }
}

/**
 * Declare a service token, installing its default binding.
 *
 * typescript-ioc silently auto-instantiates an unbound token class on get()
 * (yielding a broken, method-less instance for abstract tokens), so every
 * token MUST be declared: either with a real default factory, or without one —
 * in which case resolving before boot binds an implementation throws
 * ServiceNotBoundError instead of failing silently.
 */
export function declareService<T extends object>(
    token: ServiceIdentity<T>,
    defaultFactory?: () => T,
): void {
    const factory =
        defaultFactory ??
        (() => {
            throw new ServiceNotBoundError(token.name);
        });
    Container.bind(token as new () => T)
        .factory(factory)
        .scope(Scope.Singleton);
}

/** Bind an already-constructed instance as the singleton implementation of a token. */
export function bindService<T extends object>(token: ServiceIdentity<T>, instance: T): void {
    Container.bind(token as new () => T)
        .factory(() => instance)
        .scope(Scope.Singleton);
}

/** Resolve a service, throwing ServiceNotBoundError if only the declared default is present. */
export function resolveService<T>(token: ServiceIdentity<T>): T {
    return Container.get(token as new () => T) as T;
}

/** Resolve a service, returning null when no implementation is bound. */
export function tryResolveService<T>(token: ServiceIdentity<T>): T | null {
    try {
        return resolveService(token);
    } catch (err) {
        if (err instanceof ServiceNotBoundError) {
            return null;
        }
        throw err;
    }
}
