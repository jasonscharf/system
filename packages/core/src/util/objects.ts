/**
 * Recursively freezes an entire object tree.
 * It's important to note that this implies that objects don't share subtrees, which is a common
 * occurrance in applications that don't studiously maintain state boundaries.
 * @param obj
 * @returns
 */
export function deepFreeze<TObject>(
    obj: TObject,
    seen = new WeakMap<object, boolean>(),
): typeof obj {
    if (!exists(obj)) {
        return obj;
    }

    seen.set(obj as unknown as object, true);

    Object.getOwnPropertyNames(obj)
        .filter((prop) => !seen.has((obj as Record<string, unknown>)[prop] as object))
        .filter(
            (prop) =>
                (obj as Record<string, unknown>)[prop] &&
                typeof (obj as Record<string, unknown>)[prop] === "object",
        )
        .forEach((prop) => {
            deepFreeze((obj as Record<string, unknown>)[prop], seen);
        });

    return Object.freeze<TObject>(obj);
}

/**
 * Checks whether an object exists.
 * An object exists if it is not `null` and not `undefined`.
 */
export function exists<T>(obj: T): obj is NonNullable<T> {
    return obj !== null && obj !== undefined;
}
