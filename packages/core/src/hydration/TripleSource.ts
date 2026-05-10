import type { Triple } from '../rdf/Triple.js';


/**
 * An abstract source that produces RDF triples as an async stream.
 * Implementations cover databases, files, HTTP endpoints, and sockets.
 */
export interface TripleSource {
    stream(): AsyncIterable<Triple>;
}
