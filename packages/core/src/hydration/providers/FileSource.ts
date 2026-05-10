import type { Triple } from '../../rdf/Triple.js';
import type { TripleSource } from '../TripleSource.js';


/** Parses a raw string into triples. Supply an implementation for your preferred RDF format. */
export type TripleParser = (content: string) => AsyncIterable<Triple>;

/**
 * Streams triples from a local file.
 * Parsing is delegated to the supplied TripleParser so the source is format-agnostic.
 *
 * @example
 * import { parseNTriples } from '@system/gen';
 * const source = new FileSource('/data/graph.nt', parseNTriples);
 */
export class FileSource implements TripleSource {
    constructor(
        private readonly path: string,
        private readonly parser: TripleParser,
    ) {}

    async *stream(): AsyncIterable<Triple> {
        const { readFile } = await import('node:fs/promises');
        const content = await readFile(this.path, 'utf-8');
        yield* this.parser(content);
    }
}
