import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { IRI } from '@system/core';
import { blankNode, literal } from '@system/core';
import { generate } from '@system/gen';
import { parseNTriples } from '@system/gen';
import { readOntology } from '@system/gen';
import { generateTypes } from '@system/gen';
import type { Triple } from '@system/core';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';


async function collect(gen: AsyncIterable<Triple>): Promise<Triple[]> {
    const result: Triple[] = [];
    for await (const t of gen) result.push(t);
    return result;
}

describe('generate', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), 'tern-codegen-'));
    });

    afterEach(async () => {
        await rm(tmpDir, { recursive: true });
        vi.restoreAllMocks();
    });

    it('reads an RDF file and writes a .generated.ts sibling', async () => {
        const ntPath = join(tmpDir, 'schema.nt');
        await writeFile(ntPath,
            '<http://example.org/User> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://www.w3.org/2002/07/owl#Class> .\n'
        );

        vi.spyOn(console, 'log').mockImplementation(() => {});
        await generate(ntPath);

        const output = await readFile(join(tmpDir, 'schema.generated.ts'), 'utf-8');
        expect(output).toContain('export interface User');
    });
});

describe('parseNTriples', () => {
    it('parses IRI-only triples', async () => {
        const input = '<http://s> <http://p> <http://o> .\n';
        const triples = await collect(parseNTriples(input));
        expect(triples).toHaveLength(1);
        expect((triples[0].subject as IRI).value).toBe('http://s');
        expect(triples[0].predicate.value).toBe('http://p');
        expect((triples[0].object as IRI).value).toBe('http://o');
    });

    it('skips empty lines and comments', async () => {
        const input = '# comment\n\n<http://s> <http://p> <http://o> .\n';
        const triples = await collect(parseNTriples(input));
        expect(triples).toHaveLength(1);
    });

    it('parses blank node subject', async () => {
        const input = '_:b0 <http://p> <http://o> .\n';
        const triples = await collect(parseNTriples(input));
        expect(triples[0].subject).toMatchObject({ termType: 'BlankNode', id: 'b0' });
    });

    it('parses blank node object', async () => {
        const input = '<http://s> <http://p> _:b1 .\n';
        const triples = await collect(parseNTriples(input));
        expect(triples[0].object).toMatchObject({ termType: 'BlankNode', id: 'b1' });
    });

    it('parses plain string literal', async () => {
        const input = '<http://s> <http://p> "hello" .\n';
        const triples = await collect(parseNTriples(input));
        const obj = triples[0].object as any;
        expect(obj.termType).toBe('Literal');
        expect(obj.value).toBe('hello');
    });

    it('parses language-tagged literal', async () => {
        const input = '<http://s> <http://p> "hello"@en .\n';
        const triples = await collect(parseNTriples(input));
        const obj = triples[0].object as any;
        expect(obj.language).toBe('en');
    });

    it('parses datatype literal', async () => {
        const input = '<http://s> <http://p> "42"^^<http://www.w3.org/2001/XMLSchema#integer> .\n';
        const triples = await collect(parseNTriples(input));
        const obj = triples[0].object as any;
        expect(obj.termType).toBe('Literal');
        expect(obj.value).toBe('42');
        expect(obj.datatype.value).toContain('integer');
    });

    it('handles \\n escape in literals', async () => {
        const triples = await collect(parseNTriples('<http://s> <http://p> "line\\nbreak" .\n'));
        expect((triples[0].object as any).value).toBe('line\nbreak');
    });

    it('handles \\r escape in literals', async () => {
        const triples = await collect(parseNTriples('<http://s> <http://p> "a\\rb" .\n'));
        expect((triples[0].object as any).value).toBe('a\rb');
    });

    it('handles \\t escape in literals', async () => {
        const triples = await collect(parseNTriples('<http://s> <http://p> "a\\tb" .\n'));
        expect((triples[0].object as any).value).toBe('a\tb');
    });

    it('handles \\" escape in literals', async () => {
        const triples = await collect(parseNTriples('<http://s> <http://p> "say \\"hi\\"" .\n'));
        expect((triples[0].object as any).value).toBe('say "hi"');
    });

    it('handles \\\\ escape in literals', async () => {
        const triples = await collect(parseNTriples('<http://s> <http://p> "back\\\\slash" .\n'));
        expect((triples[0].object as any).value).toBe('back\\slash');
    });

    it('passes through unknown escape sequences', async () => {
        const triples = await collect(parseNTriples('<http://s> <http://p> "\\z" .\n'));
        expect((triples[0].object as any).value).toBe('z');
    });

    it('throws on malformed line', async () => {
        await expect(collect(parseNTriples('<http://s> <http://p> <unclosed .\n'))).rejects.toThrow();
    });
});

const OWL = 'http://www.w3.org/2002/07/owl#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const XSD = 'http://www.w3.org/2001/XMLSchema#';
const EX = 'http://example.org/';

function iri(v: string): IRI { return new IRI(v); }
function t(s: string, p: string, o: string): Triple {
    return { subject: iri(s), predicate: iri(p), object: iri(o) };
}

describe('readOntology', () => {
    const triples: Triple[] = [
        t(`${EX}User`, `${RDF}type`, `${OWL}Class`),
        t(`${EX}email`, `${RDF}type`, `${OWL}DatatypeProperty`),
        t(`${EX}email`, `${RDFS}domain`, `${EX}User`),
        t(`${EX}email`, `${RDFS}range`, `${XSD}string`),
        t(`${EX}knows`, `${RDF}type`, `${OWL}ObjectProperty`),
        t(`${EX}knows`, `${RDFS}domain`, `${EX}User`),
        t(`${EX}knows`, `${RDFS}range`, `${EX}User`),
    ];

    it('identifies OWL classes', () => {
        const ontology = readOntology(triples);
        expect(ontology.classes.has(`${EX}User`)).toBe(true);
    });

    it('identifies datatype properties', () => {
        const ontology = readOntology(triples);
        const prop = ontology.properties.get(`${EX}email`);
        expect(prop?.kind).toBe('data');
        expect(prop?.range).toBe(`${XSD}string`);
    });

    it('identifies object properties', () => {
        const ontology = readOntology(triples);
        const prop = ontology.properties.get(`${EX}knows`);
        expect(prop?.kind).toBe('object');
    });

    it('assigns properties to their domain class', () => {
        const ontology = readOntology(triples);
        const cls = ontology.classes.get(`${EX}User`)!;
        expect(cls.properties.map(p => p.iri)).toContain(`${EX}email`);
    });

    it('attaches rdfs:comment to classes and properties', () => {
        const xsdString = iri(`${XSD}string`);
        const commentTriples: Triple[] = [
            ...triples,
            {
                subject: iri(`${EX}User`),
                predicate: iri(`${RDFS}comment`),
                object: literal('A system user.', xsdString),
            },
            {
                subject: iri(`${EX}email`),
                predicate: iri(`${RDFS}comment`),
                object: literal('User email address.', xsdString),
            },
        ];
        const ontology = readOntology(commentTriples);
        expect(ontology.classes.get(`${EX}User`)?.comment).toBe('A system user.');
        expect(ontology.properties.get(`${EX}email`)?.comment).toBe('User email address.');
    });

    it('skips duplicate class definitions', () => {
        const ontology = readOntology([
            t(`${EX}User`, `${RDF}type`, `${OWL}Class`),
            t(`${EX}User`, `${RDF}type`, `${OWL}Class`),
        ]);
        expect(ontology.classes.size).toBe(1);
    });

    it('ignores rdf:type values that are not OWL class or property', () => {
        const ontology = readOntology([
            t(`${EX}Thing`, `${RDF}type`, `${OWL}Ontology`),
        ]);
        expect(ontology.classes.size).toBe(0);
        expect(ontology.properties.size).toBe(0);
    });

    it('skips duplicate property definitions', () => {
        const ontology = readOntology([
            t(`${EX}email`, `${RDF}type`, `${OWL}DatatypeProperty`),
            t(`${EX}email`, `${RDF}type`, `${OWL}DatatypeProperty`),
        ]);
        expect(ontology.properties.size).toBe(1);
    });

    it('ignores rdfs:domain triples with non-IRI object', () => {
        const xsdString = iri(`${XSD}string`);
        const ontology = readOntology([
            t(`${EX}User`, `${RDF}type`, `${OWL}Class`),
            t(`${EX}email`, `${RDF}type`, `${OWL}DatatypeProperty`),
            {
                subject: iri(`${EX}email`),
                predicate: iri(`${RDFS}domain`),
                object: literal('not-an-IRI', xsdString),
            },
        ]);
        expect(ontology.classes.get(`${EX}User`)?.properties).toHaveLength(0);
    });

    it('does not add the same property to a class twice', () => {
        const ontology = readOntology([
            ...triples,
            t(`${EX}email`, `${RDFS}domain`, `${EX}User`), // duplicate domain
        ]);
        expect(ontology.classes.get(`${EX}User`)?.properties.filter(p => p.name === 'email')).toHaveLength(1);
    });

    it('ignores rdfs:range for properties not in the registry', () => {
        const ontology = readOntology([
            t(`${EX}unknownProp`, `${RDFS}range`, `${XSD}string`),
        ]);
        expect(ontology.properties.size).toBe(0);
    });

    it('ignores triples with blank node subjects', () => {
        const withBn: Triple[] = [
            ...triples,
            { subject: blankNode('b0'), predicate: iri(`${RDF}type`), object: iri(`${OWL}Class`) },
        ];
        const ontology = readOntology(withBn);
        // Blank node subjects should not create classes
        for (const [key] of ontology.classes) {
            expect(key).not.toMatch(/^_:/);
        }
    });

    it('skips rdf:type triples whose object is not an IRI', () => {
        const xsdString = iri(`${XSD}string`);
        const withLiteralType: Triple[] = [
            { subject: iri(`${EX}Foo`), predicate: iri(`${RDF}type`), object: literal('Class', xsdString) },
        ];
        const ontology = readOntology(withLiteralType);
        expect(ontology.classes.size).toBe(0);
    });

    it('ignores rdfs:comment with an IRI object', () => {
        const commentTriples: Triple[] = [
            ...triples,
            { subject: iri(`${EX}User`), predicate: iri(`${RDFS}comment`), object: iri(`${EX}something`) },
        ];
        const ontology = readOntology(commentTriples);
        expect(ontology.classes.get(`${EX}User`)?.comment).toBeNull();
    });

    it('ignores rdfs:comment with a blank node object', () => {
        const commentTriples: Triple[] = [
            ...triples,
            { subject: iri(`${EX}User`), predicate: iri(`${RDFS}comment`), object: blankNode('b0') },
        ];
        const ontology = readOntology(commentTriples);
        expect(ontology.classes.get(`${EX}User`)?.comment).toBeNull();
    });
});

describe('generateTypes', () => {
    const triples: Triple[] = [
        t(`${EX}User`, `${RDF}type`, `${OWL}Class`),
        t(`${EX}email`, `${RDF}type`, `${OWL}DatatypeProperty`),
        t(`${EX}email`, `${RDFS}domain`, `${EX}User`),
        t(`${EX}email`, `${RDFS}range`, `${XSD}string`),
    ];

    it('generates an interface for each OWL class', () => {
        const ontology = readOntology(triples);
        const output = generateTypes(ontology, 'schema.nt');
        expect(output).toContain('export interface User');
    });

    it('generates IRI constants', () => {
        const ontology = readOntology(triples);
        const output = generateTypes(ontology, 'schema.nt');
        expect(output).toContain('export const UserIRI');
        expect(output).toContain('export const emailIRI');
    });

    it('maps XSD datatypes to TypeScript types', () => {
        const ontology = readOntology(triples);
        const output = generateTypes(ontology, 'schema.nt');
        expect(output).toContain('email?: string');
    });

    it('includes the source file name in the header', () => {
        const ontology = readOntology(triples);
        const output = generateTypes(ontology, 'my-schema.nt');
        expect(output).toContain('my-schema.nt');
    });

    it('renders property comments when present', () => {
        const xsdString = iri(`${XSD}string`);
        const withComment: Triple[] = [
            ...triples,
            {
                subject: iri(`${EX}email`),
                predicate: iri(`${RDFS}comment`),
                object: literal('The email address.', xsdString),
            },
        ];
        const ontology = readOntology(withComment);
        const output = generateTypes(ontology, 'schema.nt');
        expect(output).toContain('The email address.');
    });

    it('handles unknown XSD ranges as string', () => {
        const withUnknown: Triple[] = [
            t(`${EX}User`, `${RDF}type`, `${OWL}Class`),
            t(`${EX}foo`, `${RDF}type`, `${OWL}DatatypeProperty`),
            t(`${EX}foo`, `${RDFS}domain`, `${EX}User`),
            t(`${EX}foo`, `${RDFS}range`, `${XSD}gYear`),
        ];
        const output = generateTypes(readOntology(withUnknown), 'schema.nt');
        expect(output).toContain('foo?: string');
    });

    it('handles null range as unknown', () => {
        const withNoRange: Triple[] = [
            t(`${EX}User`, `${RDF}type`, `${OWL}Class`),
            t(`${EX}desc`, `${RDF}type`, `${OWL}DatatypeProperty`),
            t(`${EX}desc`, `${RDFS}domain`, `${EX}User`),
        ];
        const output = generateTypes(readOntology(withNoRange), 'schema.nt');
        expect(output).toContain('desc?: unknown');
    });

    it('uses the local name for non-XSD object property ranges', () => {
        const withObjectProp: Triple[] = [
            t(`${EX}User`, `${RDF}type`, `${OWL}Class`),
            t(`${EX}knows`, `${RDF}type`, `${OWL}ObjectProperty`),
            t(`${EX}knows`, `${RDFS}domain`, `${EX}User`),
            t(`${EX}knows`, `${RDFS}range`, `${EX}User`),
        ];
        const output = generateTypes(readOntology(withObjectProp), 'schema.nt');
        expect(output).toContain('knows?: User');
    });

    it('renders class-level comments', () => {
        const xsdString = iri(`${XSD}string`);
        const withClassComment: Triple[] = [
            t(`${EX}User`, `${RDF}type`, `${OWL}Class`),
            {
                subject: iri(`${EX}User`),
                predicate: iri(`${RDFS}comment`),
                object: literal('A system user.', xsdString),
            },
        ];
        const output = generateTypes(readOntology(withClassComment), 'schema.nt');
        expect(output).toContain('/** A system user. */');
    });
});
