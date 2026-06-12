/**
 * Fixture module with a callable default export for resolveModuleRef tests.
 */

export default function hello(who: string): string {
    return `hi ${who}`;
}
