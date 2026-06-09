/**
 * Minimal Turtle parser for System extension config files.
 *
 * Supported grammar subset:
 *   @prefix decl
 *   triples with IRIs, prefixed names, blank nodes (named + anonymous [])
 *   string / number / boolean literals
 *   ; (same subject, new predicate)   , (same subject+predicate, new object)
 *   a  as alias for rdf:type
 *
 * Output: a flat array of raw triples where subject/predicate/object are
 * already fully expanded IRI strings or blank-node IDs ("_:b0").
 */

export interface RawTriple {
    readonly s: string; // IRI or blank-node ID
    readonly p: string; // always IRI
    readonly o: string; // IRI, blank-node ID, or literal value
    readonly oKind: "iri" | "bnode" | "literal";
    readonly oLang?: string;
    readonly oDatatype?: string;
}

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

// ── Tokeniser ─────────────────────────────────────────────────────────────────

type TokenType =
    | "IRI"
    | "PNAME"
    | "BNODE"
    | "STRING"
    | "NUMBER"
    | "BOOL"
    | "NULL"
    | "AT_PREFIX"
    | "A"
    | "DOT"
    | "SEMICOLON"
    | "COMMA"
    | "LBRACKET"
    | "RBRACKET";

interface Token {
    type: TokenType;
    value: string;
}

function tokenise(src: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;

    const skipWsAndComments = () => {
        while (i < src.length) {
            if (/\s/.test(src[i])) {
                i++;
            } else if (src[i] === "#") {
                while (i < src.length && src[i] !== "\n") {
                    i++;
                }
            } else {
                break;
            }
        }
    };

    while (i < src.length) {
        skipWsAndComments();
        if (i >= src.length) {
            break;
        }

        const ch = src[i];

        // Punctuation
        if (ch === ".") {
            tokens.push({ type: "DOT", value: "." });
            i++;
            continue;
        }
        if (ch === ";") {
            tokens.push({ type: "SEMICOLON", value: ";" });
            i++;
            continue;
        }
        if (ch === ",") {
            tokens.push({ type: "COMMA", value: "," });
            i++;
            continue;
        }
        if (ch === "[") {
            tokens.push({ type: "LBRACKET", value: "[" });
            i++;
            continue;
        }
        if (ch === "]") {
            tokens.push({ type: "RBRACKET", value: "]" });
            i++;
            continue;
        }

        // IRI  <...>
        if (ch === "<") {
            i++;
            const start = i;
            while (i < src.length && src[i] !== ">") {
                i++;
            }
            tokens.push({ type: "IRI", value: src.slice(start, i) });
            i++; // consume '>'
            continue;
        }

        // Blank node  _:local
        if (ch === "_" && src[i + 1] === ":") {
            i += 2;
            const start = i;
            while (i < src.length && /[a-zA-Z0-9_.-]/.test(src[i])) {
                i++;
            }
            tokens.push({ type: "BNODE", value: `_:${src.slice(start, i)}` });
            continue;
        }

        // String literal  "..."
        if (ch === '"') {
            i++;
            let value = "";
            while (i < src.length && src[i] !== '"') {
                if (src[i] === "\\") {
                    i++;
                    const esc: Record<string, string> = {
                        n: "\n",
                        r: "\r",
                        t: "\t",
                        '"': '"',
                        "\\": "\\",
                    };
                    value += esc[src[i]] ?? src[i];
                } else {
                    value += src[i];
                }
                i++;
            }
            i++; // closing "
            // Consume optional ^^<datatype> or @lang
            let lang: string | undefined;
            let datatype: string | undefined;
            skipWsAndComments();
            if (src.startsWith("^^", i)) {
                i += 2;
                if (src[i] === "<") {
                    i++;
                    const start = i;
                    while (i < src.length && src[i] !== ">") {
                        i++;
                    }
                    datatype = src.slice(start, i);
                    i++;
                }
            } else if (src[i] === "@") {
                i++;
                const start = i;
                while (i < src.length && /[a-zA-Z0-9-]/.test(src[i])) {
                    i++;
                }
                lang = src.slice(start, i);
            }
            const encoded = JSON.stringify({ value, lang, datatype });
            tokens.push({ type: "STRING", value: encoded });
            continue;
        }

        // @prefix keyword
        if (src.startsWith("@prefix", i)) {
            tokens.push({ type: "AT_PREFIX", value: "@prefix" });
            i += 7;
            continue;
        }

        // Number  -?[0-9]+(\.[0-9]+)?
        if (/[-0-9]/.test(ch) && (ch !== "-" || /[0-9]/.test(src[i + 1] ?? ""))) {
            const start = i;
            if (ch === "-") {
                i++;
            }
            while (i < src.length && /[0-9.]/.test(src[i])) {
                i++;
            }
            tokens.push({ type: "NUMBER", value: src.slice(start, i) });
            continue;
        }

        // Keyword or prefixed name
        if (/[a-zA-Z_]/.test(ch)) {
            const start = i;
            while (i < src.length && /[a-zA-Z0-9_.-]/.test(src[i])) {
                i++;
            }
            const word = src.slice(start, i);

            if (word === "true" || word === "false") {
                tokens.push({ type: "BOOL", value: word });
                continue;
            }
            if (word === "null") {
                tokens.push({ type: "NULL", value: "null" });
                continue;
            }

            // Prefixed name: peek for ':'
            if (i < src.length && src[i] === ":") {
                i++;
                const localStart = i;
                while (i < src.length && /[a-zA-Z0-9_.\-/]/.test(src[i])) {
                    i++;
                }
                tokens.push({ type: "PNAME", value: `${word}:${src.slice(localStart, i)}` });
            } else {
                if (word === "a") {
                    tokens.push({ type: "A", value: "a" });
                } else {
                    tokens.push({ type: "PNAME", value: word });
                }
            }
            continue;
        }

        // Unknown — skip
        i++;
    }

    return tokens;
}

// ── Parser ────────────────────────────────────────────────────────────────────

export function parseTurtle(src: string): RawTriple[] {
    const tokens = tokenise(src);
    const prefixes = new Map<string, string>();
    const triples: RawTriple[] = [];
    let bnodeCounter = 0;
    let pos = 0;

    const peek = () => tokens[pos];
    const advance = () => tokens[pos++];
    const expect = (type: TokenType) => {
        const t = advance();
        if (!t || t.type !== type) {
            throw new Error(`Expected ${type} but got ${t?.type ?? "EOF"} ("${t?.value ?? ""}")`);
        }
        return t;
    };
    const consume = (type: TokenType): boolean => {
        if (peek()?.type === type) {
            advance();
            return true;
        }
        return false;
    };
    const freshBnode = () => `_:b${bnodeCounter++}`;

    const expandIRI = (pname: string): string => {
        const colon = pname.indexOf(":");
        if (colon === -1) {
            return pname;
        }
        const prefix = pname.slice(0, colon);
        const local = pname.slice(colon + 1);
        const ns = prefixes.get(prefix);
        if (!ns) {
            throw new Error(`Unknown prefix: ${prefix}`);
        }
        return ns + local;
    };

    const parseNodeIRI = (): string => {
        const t = advance();
        if (!t) {
            throw new Error("Unexpected EOF");
        }
        if (t.type === "IRI") {
            return t.value;
        }
        if (t.type === "PNAME") {
            return expandIRI(t.value);
        }
        if (t.type === "A") {
            return RDF_TYPE;
        }
        throw new Error(`Expected IRI or PNAME, got ${t.type} "${t.value}"`);
    };

    const parsePredicate = (): string => parseNodeIRI();

    const parseObject = (subject: string, predicate: string): void => {
        const t = peek();
        if (!t) {
            throw new Error("Unexpected EOF in object position");
        }

        if (t.type === "LBRACKET") {
            advance();
            const bnode = freshBnode();
            if (peek()?.type !== "RBRACKET") {
                parsePOList(bnode);
            }
            expect("RBRACKET");
            triples.push({ s: subject, p: predicate, o: bnode, oKind: "bnode" });
            return;
        }

        if (t.type === "BNODE") {
            advance();
            triples.push({ s: subject, p: predicate, o: t.value, oKind: "bnode" });
            return;
        }

        if (t.type === "STRING") {
            advance();
            const { value, lang, datatype } = JSON.parse(t.value) as {
                value: string;
                lang?: string;
                datatype?: string;
            };
            triples.push({
                s: subject,
                p: predicate,
                o: value,
                oKind: "literal",
                oLang: lang,
                oDatatype: datatype,
            });
            return;
        }

        if (t.type === "NUMBER") {
            advance();
            triples.push({
                s: subject,
                p: predicate,
                o: t.value,
                oKind: "literal",
                oDatatype: "http://www.w3.org/2001/XMLSchema#decimal",
            });
            return;
        }

        if (t.type === "BOOL") {
            advance();
            triples.push({
                s: subject,
                p: predicate,
                o: t.value,
                oKind: "literal",
                oDatatype: "http://www.w3.org/2001/XMLSchema#boolean",
            });
            return;
        }

        // IRI or PNAME
        const iri = parseNodeIRI();
        triples.push({ s: subject, p: predicate, o: iri, oKind: "iri" });
    };

    const parsePOList = (subject: string): void => {
        do {
            const predicate = parsePredicate();
            do {
                parseObject(subject, predicate);
            } while (consume("COMMA"));
        } while (consume("SEMICOLON"));
    };

    while (pos < tokens.length) {
        const t = peek();
        /* v8 ignore next -- loop guard ensures tokens[pos] always exists */
        if (!t) {
            break;
        }

        // @prefix  prefix: <ns> .
        if (t.type === "AT_PREFIX") {
            advance();
            const pname = expect("PNAME");
            const colon = pname.value.indexOf(":");
            const prefix = colon >= 0 ? pname.value.slice(0, colon) : pname.value;
            const ns = expect("IRI").value;
            expect("DOT");
            prefixes.set(prefix, ns);
            continue;
        }

        // Triple: subject POList .
        let subject: string;
        if (t.type === "LBRACKET") {
            advance();
            subject = freshBnode();
            if (peek()?.type !== "RBRACKET") {
                parsePOList(subject);
            }
            expect("RBRACKET");
        } else if (t.type === "BNODE") {
            advance();
            subject = t.value;
        } else {
            subject = parseNodeIRI();
        }

        if (peek()?.type !== "DOT") {
            parsePOList(subject);
        }
        expect("DOT");
    }

    return triples;
}
