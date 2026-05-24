import type { Triple } from "../rdf/Triple.js";
import type { TripleSource } from "./TripleSource.js";

/**
 * A composable, lazy wrapper around a TripleSource.
 * All transforms are applied as the stream is consumed — nothing is buffered.
 */
export class TripleStream implements AsyncIterable<Triple> {
    constructor(private readonly source: TripleSource) {}

    [Symbol.asyncIterator](): AsyncIterator<Triple> {
        return this.source.stream()[Symbol.asyncIterator]();
    }

    /** Materialize all triples into an array. */
    async collect(): Promise<Triple[]> {
        const results: Triple[] = [];
        for await (const t of this) {
            results.push(t);
        }
        return results;
    }

    /** Keep only triples that pass the predicate. */
    filter(fn: (triple: Triple) => boolean): TripleStream {
        return fromGenerator(async function* (self) {
            for await (const t of self) {
                if (fn(t)) {
                    yield t;
                }
            }
        }, this);
    }

    /** Transform each triple. */
    map(fn: (triple: Triple) => Triple): TripleStream {
        return fromGenerator(async function* (self) {
            for await (const t of self) {
                yield fn(t);
            }
        }, this);
    }

    /** Take at most n triples. */
    take(n: number): TripleStream {
        return fromGenerator(async function* (self) {
            let count = 0;
            for await (const t of self) {
                if (count++ >= n) {
                    break;
                }
                yield t;
            }
        }, this);
    }
}

function fromGenerator(
    gen: (parent: TripleStream) => AsyncIterable<Triple>,
    parent: TripleStream,
): TripleStream {
    return new TripleStream({ stream: () => gen(parent) });
}
