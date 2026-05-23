/** Koa-style middleware composition. */
export type Next = () => Promise<void>;
export type MiddlewareFn<T> = (ctx: T, next: Next) => Promise<void>;

/**
 * Composes an array of middleware functions into a single function.
 * Each middleware receives ctx and a `next` function that invokes the
 * subsequent middleware.  Calling `next` past the end of the array
 * delegates to the finalNext passed when the composed fn is called.
 */
export function compose<T>(fns: MiddlewareFn<T>[]): MiddlewareFn<T> {
    return async (ctx: T, finalNext: Next) => {
        let depth = -1;

        const dispatch = async (i: number): Promise<void> => {
            if (i <= depth) {
                throw new Error("next() called multiple times");
            }
            depth = i;
            const fn = i < fns.length ? fns[i] : finalNext;
            if (fn) {
                await fn(ctx, () => dispatch(i + 1));
            }
        };

        return dispatch(0);
    };
}
