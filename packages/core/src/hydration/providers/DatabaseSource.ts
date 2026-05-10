import type { IRI } from '../../semantics/IRI.js';
import type { RdfObject, RdfSubject, Triple } from '../../rdf/Triple.js';
import type { TripleSource } from '../TripleSource.js';


/**
 * Optional filter when querying a triple store.
 * Unset fields match any term (wildcard).
 */
export interface TriplePattern {
    subject?: RdfSubject;
    predicate?: IRI;
    object?: RdfObject;
}

/**
 * Contract for any triple-store backend.
 * Implement this interface to connect any database that stores RDF.
 *
 * @example
 * class PostgresStore implements TripleStore { ... }
 * class SparqlStore implements TripleStore { ... }
 */
export interface TripleStore {
    query(pattern: TriplePattern): AsyncIterable<Triple>;
}

/**
 * A TripleSource backed by a TripleStore.
 * Wraps the abstract store query with optional subject/predicate/object filtering.
 */
export class DatabaseSource implements TripleSource {
    constructor(
        private readonly store: TripleStore,
        private readonly pattern: TriplePattern = {},
    ) {}

    stream(): AsyncIterable<Triple> {
        return this.store.query(this.pattern);
    }
}
