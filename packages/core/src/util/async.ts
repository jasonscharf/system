/**
 * Returns once all other scheduled frames have completed.
 * This means pending from on the task queue - not in-flight promises.
 * @returns
 */
export async function flush() {
    return new Promise((resolve) => {
        schedule(resolve);
    });
}

/**
 * Sleeps for the provided number of milliseconds before invoking the specified function.
 * @param ms
 * @returns A promise that resolved once the supplied interval has elapsed
 */
export async function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Repeats the given function on the specified interval.
 * @param ms
 * @param fn
 * @returns A handle for `clearInterval`
 */
export function repeat(ms: number, fn: () => void): ReturnType<typeof setInterval> {
    return setInterval(fn, ms);
}

/* c8 ignore next */
const schedule = setTimeout;
