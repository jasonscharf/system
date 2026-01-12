/**
 * Recursively freezes an entire object tree.
 * It's important to note that this implies that objects don't share subtrees, which is a common
 * occurrance in applications that don't studiously maintain state boundaries.
 * @param obj 
 * @returns 
 */
export function deepFreeze<TObject>(obj: TObject | any, seen = new WeakMap<object, boolean>()): typeof obj {
    if (!exists(obj)) {
        return obj;
    }

    seen.set(obj, true);

    Object.getOwnPropertyNames(obj)
        .filter(prop => !seen.has(obj[prop] as unknown as any))
        .filter(prop => obj[prop] && typeof obj[prop] === "object")
        .forEach(prop => deepFreeze(obj[prop], seen));

    return Object.freeze<TObject>(obj);
}

/**
 * Checks whether an object exists.
 * An object exists if it is not `null` and not `undefined`.
 */
export function exists<T>(obj: T): obj is NonNullable<T> {
    return (obj !== null && obj !== undefined);
}

