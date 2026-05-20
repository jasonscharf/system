import { IRI } from '@jasonscharf/core';
import { blankNode, literal } from '@jasonscharf/core';
import type { Triple, RdfSubject, RdfObject } from '@jasonscharf/core';


const RDF_TYPE    = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const XSD_STRING  = new IRI('http://www.w3.org/2001/XMLSchema#string');
const XSD_INTEGER = new IRI('http://www.w3.org/2001/XMLSchema#integer');
const XSD_DECIMAL = new IRI('http://www.w3.org/2001/XMLSchema#decimal');
const XSD_BOOLEAN = new IRI('http://www.w3.org/2001/XMLSchema#boolean');
const RDF_LANG_STRING = new IRI('http://www.w3.org/1999/02/22-rdf-syntax-ns#langString');

/**
 * Parses a Turtle document (https://www.w3.org/TR/turtle/) into triples.
 *
 * Supported features:
 *   @prefix / PREFIX declarations
 *   Full IRIs <...>, prefixed names prefix:local
 *   Keyword `a` as shorthand for rdf:type
 *   Predicate lists  (subject pred1 obj1 ; pred2 obj2 .)
 *   Object lists     (subject pred obj1 , obj2 .)
 *   Anonymous blank nodes [ pred obj ; ... ] (inline PropertyList)
 *   Named blank nodes _:id
 *   String literals with optional ^^datatype or @lang tag
 *   Integer, decimal, boolean shorthand literals
 */
export async function* parseTurtle(content: string): AsyncGenerator<Triple> {
    const r = new TurtleReader(content);
    for (const t of r.parse()) {
        yield t;
    }
}

class TurtleReader {
    private _pos    = 0;
    private _blanks = 0;
    private _prefixes = new Map<string, string>();

    constructor(private readonly _src: string) {}

    parse(): Triple[] {
        const out: Triple[] = [];
        while (this._pos < this._src.length) {
            this._skipWsAndComments();
            if (this._pos >= this._src.length) { break; }

            if (this._at('@')) {
                this._parseDirective();
            } else if (this._matchesKeyword('PREFIX') || this._matchesKeyword('BASE')) {
                this._parseSparqlDirective();
            } else {
                this._parseTriples(out);
            }
        }
        return out;
    }

    // ── Directives ────────────────────────────────────────────────────────────

    private _parseDirective(): void {
        if (this._src.startsWith('@prefix', this._pos)) {
            this._pos += '@prefix'.length;
            this._skipWs();
            const prefix = this._parsePrefixLabel(); // "foo:"
            this._skipWs();
            const iri = this._parseFullIRIString();
            this._skipWsAndComments();
            this._expect('.');
            this._prefixes.set(prefix, iri);
        } else if (this._src.startsWith('@base', this._pos)) {
            this._pos += '@base'.length;
            this._skipWs();
            this._parseFullIRIString(); // ignored for now
            this._skipWsAndComments();
            this._expect('.');
        } else {
            throw new Error(`Unknown directive at pos ${this._pos}: ${this._src.slice(this._pos, this._pos + 20)}`);
        }
    }

    private _parseSparqlDirective(): void {
        if (this._matchesKeyword('PREFIX')) {
            this._pos += 'PREFIX'.length;
            this._skipWs();
            const prefix = this._parsePrefixLabel();
            this._skipWs();
            const iri = this._parseFullIRIString();
            this._prefixes.set(prefix, iri);
        } else {
            this._pos += 'BASE'.length;
            this._skipWs();
            this._parseFullIRIString();
        }
    }

    // ── Triples ───────────────────────────────────────────────────────────────

    private _parseTriples(out: Triple[]): void {
        const subject = this._parseSubject(out);
        this._skipWsAndComments();

        const ch = this._peek();
        if (ch !== '.' && ch !== undefined) {
            this._parsePredicateObjectList(out, subject);
        }

        this._skipWsAndComments();
        this._expect('.');
    }

    private _parseSubject(out: Triple[]): RdfSubject {
        if (this._at('[')) { return this._parseAnonBlank(out); }
        return this._parseNode() as RdfSubject;
    }

    private _parsePredicateObjectList(out: Triple[], subject: RdfSubject): void {
        this._parseVerbObjectList(out, subject);

        while (true) {
            this._skipWsAndComments();
            if (!this._at(';')) { break; }
            this._pos++; // consume ';'
            this._skipWsAndComments();
            // Trailing semicolon before '.' or ']' is valid
            const ch = this._peek();
            if (ch === '.' || ch === ']' || ch === undefined) { break; }
            this._parseVerbObjectList(out, subject);
        }
    }

    private _parseVerbObjectList(out: Triple[], subject: RdfSubject): void {
        const predicate = this._parsePredicate();
        this._skipWsAndComments();

        const obj = this._parseObject(out);
        out.push({ subject, predicate, object: obj });

        while (true) {
            this._skipWsAndComments();
            if (!this._at(',')) { break; }
            this._pos++; // consume ','
            this._skipWsAndComments();
            const nextObj = this._parseObject(out);
            out.push({ subject, predicate, object: nextObj });
        }
    }

    private _parsePredicate(): IRI {
        // 'a' keyword → rdf:type
        if (this._src[this._pos] === 'a' && /[\s\t\r\n<\[_"']/.test(this._src[this._pos + 1] ?? ' ')) {
            this._pos++;
            return new IRI(RDF_TYPE);
        }
        return this._parseIRI();
    }

    private _parseObject(out: Triple[]): RdfObject {
        const ch = this._peek();

        if (ch === '[') { return this._parseAnonBlank(out); }
        if (ch === '"' || ch === "'") { return this._parseStringLiteral(); }

        if (this._src.startsWith('true', this._pos) && /[\s,;.\])]/.test(this._src[this._pos + 4] ?? ' ')) {
            this._pos += 4;
            return literal('true', XSD_BOOLEAN);
        }
        if (this._src.startsWith('false', this._pos) && /[\s,;.\])]/.test(this._src[this._pos + 5] ?? ' ')) {
            this._pos += 5;
            return literal('false', XSD_BOOLEAN);
        }

        if (/[0-9+\-]/.test(ch ?? '')) {
            return this._parseNumericLiteral();
        }

        return this._parseNode() as RdfObject;
    }

    // ── Blank nodes ───────────────────────────────────────────────────────────

    private _parseAnonBlank(out: Triple[]): typeof blankNode extends (...args: any[]) => infer R ? R : never {
        this._expect('[');
        const node = blankNode(`b${++this._blanks}`);
        this._skipWsAndComments();
        if (!this._at(']')) {
            this._parsePredicateObjectList(out, node);
            this._skipWsAndComments();
        }
        this._expect(']');
        return node;
    }

    private _parseNamedBlank() {
        this._expect('_');
        this._expect(':');
        const start = this._pos;
        while (this._pos < this._src.length && /[a-zA-Z0-9_.\-]/.test(this._src[this._pos])) {
            this._pos++;
        }
        return blankNode(this._src.slice(start, this._pos));
    }

    // ── Nodes (IRI or blank) ──────────────────────────────────────────────────

    private _parseNode(): IRI | ReturnType<typeof blankNode> {
        if (this._at('<')) { return this._parseFullIRI(); }
        if (this._at('_')) { return this._parseNamedBlank(); }
        return this._parsePrefixedName();
    }

    private _parseIRI(): IRI {
        if (this._at('<')) { return this._parseFullIRI(); }
        return this._parsePrefixedName();
    }

    private _parseFullIRI(): IRI {
        this._expect('<');
        const start = this._pos;
        while (this._pos < this._src.length && this._src[this._pos] !== '>') { this._pos++; }
        const val = this._src.slice(start, this._pos);
        this._expect('>');
        return new IRI(val);
    }

    private _parseFullIRIString(): string {
        return this._parseFullIRI().value;
    }

    private _parsePrefixedName(): IRI {
        const start = this._pos;
        // prefix: everything up to ':'
        while (this._pos < this._src.length && this._src[this._pos] !== ':' && /[a-zA-Z0-9_\-.]/.test(this._src[this._pos])) {
            this._pos++;
        }
        const prefix = this._src.slice(start, this._pos);
        this._expect(':');
        // local name: everything until delimiter
        const localStart = this._pos;
        while (this._pos < this._src.length && !/[\s\t\r\n,;.)\]>]/.test(this._src[this._pos])) {
            this._pos++;
        }
        const local = this._src.slice(localStart, this._pos);
        const base = this._prefixes.get(prefix);
        if (base === undefined) {
            throw new Error(`Unknown prefix "${prefix}:" at pos ${start}: ${this._src.slice(start, start + 30)}`);
        }
        return new IRI(base + local);
    }

    // "prefix:" label as used in @prefix declarations — includes the trailing ':'
    private _parsePrefixLabel(): string {
        const start = this._pos;
        while (this._pos < this._src.length && /[a-zA-Z0-9_\-.]/.test(this._src[this._pos])) {
            this._pos++;
        }
        this._expect(':');
        return this._src.slice(start, this._pos - 1); // without ':'
    }

    // ── Literals ──────────────────────────────────────────────────────────────

    private _parseStringLiteral(): ReturnType<typeof literal> {
        // Support both single and double quotes, and triple-quoted forms
        const q = this._src[this._pos];
        let value = '';

        if (this._src.startsWith(q + q + q, this._pos)) {
            // Triple-quoted
            this._pos += 3;
            const end = q + q + q;
            while (this._pos < this._src.length && !this._src.startsWith(end, this._pos)) {
                const ch = this._src[this._pos++];
                value += ch === '\\' ? this._unescape(this._src[this._pos++]) : ch;
            }
            this._pos += 3;
        } else {
            this._pos++; // opening quote
            while (this._pos < this._src.length && this._src[this._pos] !== q) {
                const ch = this._src[this._pos++];
                value += ch === '\\' ? this._unescape(this._src[this._pos++]) : ch;
            }
            this._expect(q);
        }

        // Datatype
        if (this._src.startsWith('^^', this._pos)) {
            this._pos += 2;
            return literal(value, this._parseIRI());
        }
        // Language tag
        if (this._at('@')) {
            this._pos++;
            const start = this._pos;
            while (this._pos < this._src.length && /[a-zA-Z0-9\-]/.test(this._src[this._pos])) { this._pos++; }
            return literal(value, RDF_LANG_STRING, this._src.slice(start, this._pos));
        }
        return literal(value, XSD_STRING);
    }

    private _parseNumericLiteral(): ReturnType<typeof literal> {
        const start = this._pos;
        if (this._at('+') || this._at('-')) { this._pos++; }
        while (this._pos < this._src.length && /[0-9]/.test(this._src[this._pos])) { this._pos++; }
        const isDecimal = this._at('.');
        if (isDecimal) {
            this._pos++;
            while (this._pos < this._src.length && /[0-9]/.test(this._src[this._pos])) { this._pos++; }
        }
        const value = this._src.slice(start, this._pos);
        return literal(value, isDecimal ? XSD_DECIMAL : XSD_INTEGER);
    }

    // ── Utilities ─────────────────────────────────────────────────────────────

    private _peek(): string | undefined { return this._src[this._pos]; }
    private _at(ch: string): boolean    { return this._src[this._pos] === ch; }

    private _matchesKeyword(kw: string): boolean {
        return this._src.startsWith(kw, this._pos) && /[\s\t\r\n]/.test(this._src[this._pos + kw.length] ?? ' ');
    }

    private _expect(ch: string): void {
        if (this._src[this._pos] !== ch) {
            const ctx = this._src.slice(Math.max(0, this._pos - 30), this._pos + 30);
            throw new Error(`Expected '${ch}' at pos ${this._pos}; got '${this._src[this._pos] ?? 'EOF'}'\n  …${ctx}…`);
        }
        this._pos++;
    }

    private _skipWs(): void {
        while (this._pos < this._src.length && /[ \t\r\n]/.test(this._src[this._pos])) { this._pos++; }
    }

    private _skipWsAndComments(): void {
        while (this._pos < this._src.length) {
            if (/[ \t\r\n]/.test(this._src[this._pos])) {
                this._pos++;
            } else if (this._src[this._pos] === '#') {
                while (this._pos < this._src.length && this._src[this._pos] !== '\n') { this._pos++; }
            } else {
                break;
            }
        }
    }

    private _unescape(ch: string): string {
        switch (ch) {
            case 'n':  return '\n';
            case 'r':  return '\r';
            case 't':  return '\t';
            case '"':  return '"';
            case "'":  return "'";
            case '\\': return '\\';
            default:   return ch;
        }
    }
}
