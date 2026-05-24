import type { Triple } from "../../rdf/Triple.js";
import type { TripleSource } from "../TripleSource.js";

/**
 * Deserializes a raw WebSocket message into triples.
 * The wire format is left to the implementor; a common choice is newline-delimited N-Triples.
 */
export type SocketTripleDeserializer = (message: string) => Triple[];

/**
 * Streams triples from a WebSocket connection.
 * Each message is deserialized into one or more triples via the supplied deserializer.
 * The stream ends when the socket closes.
 *
 * @example
 * const source = new SocketSource('ws://localhost:4000/stream', deserializeNdTriples);
 */
export class SocketSource implements TripleSource {
    constructor(
        private readonly url: string,
        private readonly deserializer: SocketTripleDeserializer,
    ) {}

    async *stream(): AsyncIterable<Triple> {
        const socket = new WebSocket(this.url);

        // Phase 1: wait for the connection to open.
        await new Promise<void>((res, rej) => {
            socket.addEventListener("open", () => res());
            socket.addEventListener("error", () => rej(new Error(`Cannot connect to ${this.url}`)));
        });

        // Phase 2: buffer messages and stream them as triples.
        const queue: Triple[][] = [];
        let done = false;
        let resolve!: () => void;
        let reject!: (err: Error) => void;
        let waiting = new Promise<void>((res, rej) => {
            resolve = res;
            reject = rej;
        });

        socket.addEventListener("message", (ev) => {
            queue.push(this.deserializer(ev.data as string));
            resolve();
            waiting = new Promise<void>((res, rej) => {
                resolve = res;
                reject = rej;
            });
        });

        socket.addEventListener("close", () => {
            done = true;
            resolve();
        });

        socket.addEventListener("error", () => {
            reject(new Error(`WebSocket error on ${this.url}`));
        });

        while (!done || queue.length > 0) {
            if (queue.length === 0) {
                await waiting;
            }
            const batch = queue.shift();
            if (batch) {
                for (const t of batch) {
                    yield t;
                }
            }
        }
    }
}
