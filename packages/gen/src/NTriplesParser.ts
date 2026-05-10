import { IRI } from '@system/core';
import { blankNode, literal } from '@system/core';
import type { Triple, RdfSubject, RdfObject } from '@system/core';


// XSD string IRI — the implicit datatype for untyped plain literals
const XSD_STRING = new IRI('http://www.w3.org/2001/XMLSchema#string');
const RDF_LANG_STRING = new IRI('http://www.w3.org/1999/02/22-rdf-syntax-ns#langString');

/**
 * Parses N-Triples content (https://www.w3.org/TR/n-triples/) into triples.
 * Each non-empty, non-comment line must be a complete triple ending with ' .'.
 */
export async function* parseNTriples(content: string): AsyncGenerator<Triple> {
    for (const rawLine of content.split('\n')) {
        const line = rawLine.trim();

        if (line.length === 0 || line.startsWith('#')) continue;

        yield parseLine(line);
    }
}

function parseLine(line: string): Triple {
    const pos = new Parser(line);
    const subject = parseSubject(pos);
    pos.skipWhitespace();
    const predicate = parseIRI(pos);
    pos.skipWhitespace();
    const object = parseObject(pos);
    pos.skipWhitespace();
    pos.expect('.');

    return { subject, predicate, object };
}

function parseSubject(p: Parser): RdfSubject {
    if (p.peek() === '_') return parseBlankNode(p);
    return parseIRI(p);
}

function parseObject(p: Parser): RdfObject {
    if (p.peek() === '_') return parseBlankNode(p);
    if (p.peek() === '"') return parseLiteral(p);
    return parseIRI(p);
}

function parseIRI(p: Parser): IRI {
    p.expect('<');
    const start = p.pos;
    while (p.pos < p.src.length && p.src[p.pos] !== '>') p.pos++;
    const value = p.src.slice(start, p.pos);
    p.expect('>');
    return new IRI(value);
}

function parseBlankNode(p: Parser) {
    p.expect('_');
    p.expect(':');
    const start = p.pos;
    while (p.pos < p.src.length && !/[\s,;.]/.test(p.src[p.pos])) p.pos++;
    return blankNode(p.src.slice(start, p.pos));
}

function parseLiteral(p: Parser) {
    p.expect('"');
    let value = '';
    while (p.pos < p.src.length) {
        const ch = p.src[p.pos++];
        if (ch === '\\') {
            value += unescape(p.src[p.pos++]);
        } else if (ch === '"') {
            break;
        } else {
            value += ch;
        }
    }

    // Language tag: "value"@en
    if (p.peek() === '@') {
        p.pos++;
        const start = p.pos;
        while (p.pos < p.src.length && /[a-zA-Z0-9-]/.test(p.src[p.pos])) p.pos++;
        return literal(value, RDF_LANG_STRING, p.src.slice(start, p.pos));
    }

    // Datatype: "value"^^<IRI>
    if (p.src.startsWith('^^', p.pos)) {
        p.pos += 2;
        return literal(value, parseIRI(p));
    }

    return literal(value, XSD_STRING);
}

function unescape(ch: string): string {
    switch (ch) {
        case 'n': return '\n';
        case 'r': return '\r';
        case 't': return '\t';
        case '"': return '"';
        case '\\': return '\\';
        default: return ch;
    }
}

class Parser {
    pos = 0;
    constructor(readonly src: string) {}

    peek(): string { return this.src[this.pos]; }

    expect(ch: string) {
        if (this.src[this.pos] !== ch) {
            throw new Error(`Expected '${ch}' at position ${this.pos} in: ${this.src}`);
        }
        this.pos++;
    }

    skipWhitespace() {
        while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++;
    }
}
