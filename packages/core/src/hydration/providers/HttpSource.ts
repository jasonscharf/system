import type { Triple } from '../../rdf/Triple.js';
import type { TripleSource } from '../TripleSource.js';
import type { TripleParser } from './FileSource.js';


/**
 * Streams triples by dereferencing an IRI via HTTP.
 * Accepts any Accept header and delegates parsing to the supplied TripleParser.
 *
 * @example
 * const source = new HttpSource('https://example.org/data.nt', parseNTriples);
 */
export class HttpSource implements TripleSource {
    constructor(
        private readonly url: string,
        private readonly parser: TripleParser,
        private readonly init: RequestInit = {},
    ) {}

    async *stream(): AsyncIterable<Triple> {
        const response = await fetch(this.url, {
            headers: { Accept: 'application/n-triples, text/turtle;q=0.9' },
            ...this.init,
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} fetching ${this.url}`);
        }

        const text = await response.text();
        yield* this.parser(text);
    }
}
