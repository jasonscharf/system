/**
 * A typed token used to register and resolve services from a ServiceContainer.
 * Each token uses a unique Symbol internally so two tokens with the same name
 * never collide.
 */
export class ServiceToken<T> {
    /** Phantom field — never set at runtime; holds the type T for the compiler. */
    declare readonly _type: T;
    readonly key: symbol;
    readonly name: string;

    constructor(name: string) {
        this.name = name;
        this.key = Symbol(name);
    }

    toString(): string {
        return `ServiceToken(${this.name})`;
    }
}

