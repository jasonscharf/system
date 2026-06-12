/**
 * Fixture module with named exports for resolveModuleRef tests.
 */

export function greet(name: string): string {
    return `Hello, ${name}!`;
}

export const answerToEverything = 42;

export class Greeter {
    private _prefix: string;

    constructor(prefix: string) {
        this._prefix = prefix;
    }

    greet(name: string): string {
        return `${this._prefix} ${name}`;
    }
}

const defaultExport = {
    sweep(scope: string): string {
        return `sweeping scope=${scope}`;
    },

    compute(): number {
        return 100;
    },
};

export default defaultExport;
