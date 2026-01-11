/**
 * Returns once all other scheduled frames have completed.
 * This means pending from on the task queue - not in-flight promises.
 * @returns 
 */
export async function flush() {
    return new Promise((resolve) => { schedule(resolve); })
}

export async function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function repeat(ms: number, fn: Function) {
    return setInterval(fn, ms);
}

const schedule = typeof setImmediate === "function" ? setImmediate : setTimeout;
