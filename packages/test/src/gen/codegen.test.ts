import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blankNode, IRI, type Literal, literal, type Triple } from "@jasonscharf/core";
import type { ShaclShapes } from "@jasonscharf/gen";
import {
    generate,
    generateAugmentedTypes,
    generateFromConfig,
    generateShapesDescriptor,
    generateTypes,
    mergeShapes,
    parseNTriples,
    parseTurtle,
    readOntology,
    readShaclShapes,
    validate,
} from "@jasonscharf/gen";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

async function collect(gen: AsyncIterable<Triple>): Promise<Triple[]> {
    const result: Triple[] = [];
    for await (const t of gen) {
        result.push(t);
    }
    return result;
}

describe("generate", () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "tern-codegen-"));
    });

    afterEach(async () => {
        await rm(tmpDir, { recursive: true });
    });

    it("reads an RDF file and writes a .generated.ts sibling", async () => {
        const ntPath = join(tmpDir, "schema.nt");
        await writeFile(
            ntPath,
            "<http://example.org/User> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://www.w3.org/2002/07/owl#Class> .\n",
        );

        await generate(ntPath);

        const output = await readFile(join(tmpDir, "schema.generated.ts"), "utf-8");
        expect(output).toContain("export interface User");
    });
});

describe("parseNTriples", () => {
    it("parses IRI-only triples", async () => {
        const input = "<http://s> <http://p> <http://o> .\n";
        const triples = await collect(parseNTriples(input));
        expect(triples).toHaveLength(1);
        expect((triples[0].subject as IRI).value).toBe("http://s");
        expect(triples[0].predicate.value).toBe("http://p");
        expect((triples[0].object as IRI).value).toBe("http://o");
    });

    it("skips empty lines and comments", async () => {
        const input = "# comment\n\n<http://s> <http://p> <http://o> .\n";
        const triples = await collect(parseNTriples(input));
        expect(triples).toHaveLength(1);
    });

    it("parses blank node subject", async () => {
        const input = "_:b0 <http://p> <http://o> .\n";
        const triples = await collect(parseNTriples(input));
        expect(triples[0].subject).toMatchObject({ termType: "BlankNode", id: "b0" });
    });

    it("parses blank node object", async () => {
        const input = "<http://s> <http://p> _:b1 .\n";
        const triples = await collect(parseNTriples(input));
        expect(triples[0].object).toMatchObject({ termType: "BlankNode", id: "b1" });
    });

    it("parses plain string literal", async () => {
        const input = '<http://s> <http://p> "hello" .\n';
        const triples = await collect(parseNTriples(input));
        const obj = triples[0].object as Literal;
        expect(obj.termType).toBe("Literal");
        expect(obj.value).toBe("hello");
    });

    it("parses language-tagged literal", async () => {
        const input = '<http://s> <http://p> "hello"@en .\n';
        const triples = await collect(parseNTriples(input));
        const obj = triples[0].object as Literal;
        expect(obj.language).toBe("en");
    });

    it("parses datatype literal", async () => {
        const input = '<http://s> <http://p> "42"^^<http://www.w3.org/2001/XMLSchema#integer> .\n';
        const triples = await collect(parseNTriples(input));
        const obj = triples[0].object as Literal;
        expect(obj.termType).toBe("Literal");
        expect(obj.value).toBe("42");
        expect(obj.datatype.value).toContain("integer");
    });

    it("handles \\n escape in literals", async () => {
        const triples = await collect(parseNTriples('<http://s> <http://p> "line\\nbreak" .\n'));
        expect((triples[0].object as Literal).value).toBe("line\nbreak");
    });

    it("handles \\r escape in literals", async () => {
        const triples = await collect(parseNTriples('<http://s> <http://p> "a\\rb" .\n'));
        expect((triples[0].object as Literal).value).toBe("a\rb");
    });

    it("handles \\t escape in literals", async () => {
        const triples = await collect(parseNTriples('<http://s> <http://p> "a\\tb" .\n'));
        expect((triples[0].object as Literal).value).toBe("a\tb");
    });

    it('handles \\" escape in literals', async () => {
        const triples = await collect(parseNTriples('<http://s> <http://p> "say \\"hi\\"" .\n'));
        expect((triples[0].object as Literal).value).toBe('say "hi"');
    });

    it("handles \\\\ escape in literals", async () => {
        const triples = await collect(parseNTriples('<http://s> <http://p> "back\\\\slash" .\n'));
        expect((triples[0].object as Literal).value).toBe("back\\slash");
    });

    it("passes through unknown escape sequences", async () => {
        const triples = await collect(parseNTriples('<http://s> <http://p> "\\z" .\n'));
        expect((triples[0].object as Literal).value).toBe("z");
    });

    it("throws on malformed line", async () => {
        await expect(
            collect(parseNTriples("<http://s> <http://p> <unclosed .\n")),
        ).rejects.toThrow();
    });
});

const OWL = "http://www.w3.org/2002/07/owl#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const EX = "http://example.org/";

function iri(v: string): IRI {
    return new IRI(v);
}
function t(s: string, p: string, o: string): Triple {
    return { subject: iri(s), predicate: iri(p), object: iri(o) };
}

describe("readOntology", () => {
    const triples: Triple[] = [
        t(`${EX}User`, `${RDF}type`, `${OWL}Class`),
        t(`${EX}email`, `${RDF}type`, `${OWL}DatatypeProperty`),
        t(`${EX}email`, `${RDFS}domain`, `${EX}User`),
        t(`${EX}email`, `${RDFS}range`, `${XSD}string`),
        t(`${EX}knows`, `${RDF}type`, `${OWL}ObjectProperty`),
        t(`${EX}knows`, `${RDFS}domain`, `${EX}User`),
        t(`${EX}knows`, `${RDFS}range`, `${EX}User`),
    ];

    it("identifies OWL classes", () => {
        const ontology = readOntology(triples);
        expect(ontology.classes.has(`${EX}User`)).toBe(true);
    });

    it("identifies datatype properties", () => {
        const ontology = readOntology(triples);
        const prop = ontology.properties.get(`${EX}email`);
        expect(prop?.kind).toBe("data");
        expect(prop?.range).toBe(`${XSD}string`);
    });

    it("identifies object properties", () => {
        const ontology = readOntology(triples);
        const prop = ontology.properties.get(`${EX}knows`);
        expect(prop?.kind).toBe("object");
    });

    it("assigns properties to their domain class", () => {
        const ontology = readOntology(triples);
        const cls = ontology.classes.get(`${EX}User`);
        if (cls == null) {
            throw new Error("expected User class in ontology");
        }
        expect(cls.properties.map((p) => p.iri)).toContain(`${EX}email`);
    });

    it("attaches rdfs:comment to classes and properties", () => {
        const xsdString = iri(`${XSD}string`);
        const commentTriples: Triple[] = [
            ...triples,
            {
                subject: iri(`${EX}User`),
                predicate: iri(`${RDFS}comment`),
                object: literal("A system user.", xsdString),
            },
            {
                subject: iri(`${EX}email`),
                predicate: iri(`${RDFS}comment`),
                object: literal("User email address.", xsdString),
            },
        ];
        const ontology = readOntology(commentTriples);
        expect(ontology.classes.get(`${EX}User`)?.comment).toBe("A system user.");
        expect(ontology.properties.get(`${EX}email`)?.comment).toBe("User email address.");
    });

    it("skips duplicate class definitions", () => {
        const ontology = readOntology([
            t(`${EX}User`, `${RDF}type`, `${OWL}Class`),
            t(`${EX}User`, `${RDF}type`, `${OWL}Class`),
        ]);
        expect(ontology.classes.size).toBe(1);
    });

    it("ignores rdf:type values that are not OWL class or property", () => {
        const ontology = readOntology([t(`${EX}Thing`, `${RDF}type`, `${OWL}Ontology`)]);
        expect(ontology.classes.size).toBe(0);
        expect(ontology.properties.size).toBe(0);
    });

    it("skips duplicate property definitions", () => {
        const ontology = readOntology([
            t(`${EX}email`, `${RDF}type`, `${OWL}DatatypeProperty`),
            t(`${EX}email`, `${RDF}type`, `${OWL}DatatypeProperty`),
        ]);
        expect(ontology.properties.size).toBe(1);
    });

    it("ignores rdfs:domain triples with non-IRI object", () => {
        const xsdString = iri(`${XSD}string`);
        const ontology = readOntology([
            t(`${EX}User`, `${RDF}type`, `${OWL}Class`),
            t(`${EX}email`, `${RDF}type`, `${OWL}DatatypeProperty`),
            {
                subject: iri(`${EX}email`),
                predicate: iri(`${RDFS}domain`),
                object: literal("not-an-IRI", xsdString),
            },
        ]);
        expect(ontology.classes.get(`${EX}User`)?.properties).toHaveLength(0);
    });

    it("does not add the same property to a class twice", () => {
        const ontology = readOntology([
            ...triples,
            t(`${EX}email`, `${RDFS}domain`, `${EX}User`), // duplicate domain
        ]);
        expect(
            ontology.classes.get(`${EX}User`)?.properties.filter((p) => p.name === "email"),
        ).toHaveLength(1);
    });

    it("ignores rdfs:range for properties not in the registry", () => {
        const ontology = readOntology([t(`${EX}unknownProp`, `${RDFS}range`, `${XSD}string`)]);
        expect(ontology.properties.size).toBe(0);
    });

    it("ignores triples with blank node subjects", () => {
        const withBn: Triple[] = [
            ...triples,
            { subject: blankNode("b0"), predicate: iri(`${RDF}type`), object: iri(`${OWL}Class`) },
        ];
        const ontology = readOntology(withBn);
        // Blank node subjects should not create classes
        for (const [key] of ontology.classes) {
            expect(key).not.toMatch(/^_:/);
        }
    });

    it("skips rdf:type triples whose object is not an IRI", () => {
        const xsdString = iri(`${XSD}string`);
        const withLiteralType: Triple[] = [
            {
                subject: iri(`${EX}Foo`),
                predicate: iri(`${RDF}type`),
                object: literal("Class", xsdString),
            },
        ];
        const ontology = readOntology(withLiteralType);
        expect(ontology.classes.size).toBe(0);
    });

    it("ignores rdfs:comment with an IRI object", () => {
        const commentTriples: Triple[] = [
            ...triples,
            {
                subject: iri(`${EX}User`),
                predicate: iri(`${RDFS}comment`),
                object: iri(`${EX}something`),
            },
        ];
        const ontology = readOntology(commentTriples);
        expect(ontology.classes.get(`${EX}User`)?.comment).toBeNull();
    });

    it("ignores rdfs:comment with a blank node object", () => {
        const commentTriples: Triple[] = [
            ...triples,
            {
                subject: iri(`${EX}User`),
                predicate: iri(`${RDFS}comment`),
                object: blankNode("b0"),
            },
        ];
        const ontology = readOntology(commentTriples);
        expect(ontology.classes.get(`${EX}User`)?.comment).toBeNull();
    });
});

describe("generateTypes", () => {
    const triples: Triple[] = [
        t(`${EX}User`, `${RDF}type`, `${OWL}Class`),
        t(`${EX}email`, `${RDF}type`, `${OWL}DatatypeProperty`),
        t(`${EX}email`, `${RDFS}domain`, `${EX}User`),
        t(`${EX}email`, `${RDFS}range`, `${XSD}string`),
    ];

    it("generates an interface for each OWL class", () => {
        const ontology = readOntology(triples);
        const output = generateTypes(ontology, "schema.nt");
        expect(output).toContain("export interface User");
    });

    it("generates IRI constants", () => {
        const ontology = readOntology(triples);
        const output = generateTypes(ontology, "schema.nt");
        expect(output).toContain("export const UserIRI");
        expect(output).toContain("export const emailIRI");
    });

    it("maps XSD datatypes to TypeScript types", () => {
        const ontology = readOntology(triples);
        const output = generateTypes(ontology, "schema.nt");
        expect(output).toContain("email?: string");
    });

    it("includes the source file name in the header", () => {
        const ontology = readOntology(triples);
        const output = generateTypes(ontology, "my-schema.nt");
        expect(output).toContain("my-schema.nt");
    });

    it("renders property comments when present", () => {
        const xsdString = iri(`${XSD}string`);
        const withComment: Triple[] = [
            ...triples,
            {
                subject: iri(`${EX}email`),
                predicate: iri(`${RDFS}comment`),
                object: literal("The email address.", xsdString),
            },
        ];
        const ontology = readOntology(withComment);
        const output = generateTypes(ontology, "schema.nt");
        expect(output).toContain("The email address.");
    });

    it("handles unknown XSD ranges as string", () => {
        const withUnknown: Triple[] = [
            t(`${EX}User`, `${RDF}type`, `${OWL}Class`),
            t(`${EX}foo`, `${RDF}type`, `${OWL}DatatypeProperty`),
            t(`${EX}foo`, `${RDFS}domain`, `${EX}User`),
            t(`${EX}foo`, `${RDFS}range`, `${XSD}gYear`),
        ];
        const output = generateTypes(readOntology(withUnknown), "schema.nt");
        expect(output).toContain("foo?: string");
    });

    it("handles null range as unknown", () => {
        const withNoRange: Triple[] = [
            t(`${EX}User`, `${RDF}type`, `${OWL}Class`),
            t(`${EX}desc`, `${RDF}type`, `${OWL}DatatypeProperty`),
            t(`${EX}desc`, `${RDFS}domain`, `${EX}User`),
        ];
        const output = generateTypes(readOntology(withNoRange), "schema.nt");
        expect(output).toContain("desc?: unknown");
    });

    it("uses the local name for non-XSD object property ranges", () => {
        const withObjectProp: Triple[] = [
            t(`${EX}User`, `${RDF}type`, `${OWL}Class`),
            t(`${EX}knows`, `${RDF}type`, `${OWL}ObjectProperty`),
            t(`${EX}knows`, `${RDFS}domain`, `${EX}User`),
            t(`${EX}knows`, `${RDFS}range`, `${EX}User`),
        ];
        const output = generateTypes(readOntology(withObjectProp), "schema.nt");
        expect(output).toContain("knows?: User");
    });

    it("renders class-level comments", () => {
        const xsdString = iri(`${XSD}string`);
        const withClassComment: Triple[] = [
            t(`${EX}User`, `${RDF}type`, `${OWL}Class`),
            {
                subject: iri(`${EX}User`),
                predicate: iri(`${RDFS}comment`),
                object: literal("A system user.", xsdString),
            },
        ];
        const output = generateTypes(readOntology(withClassComment), "schema.nt");
        expect(output).toContain("/** A system user. */");
    });
});

// ── parseTurtle ───────────────────────────────────────────────────────────────

async function collectTurtle(content: string): Promise<Triple[]> {
    const result: Triple[] = [];
    for await (const t of parseTurtle(content)) {
        result.push(t);
    }
    return result;
}

describe("parseTurtle", () => {
    it("parses @prefix declarations and prefixed names", async () => {
        const ttl = `
@prefix ex: <http://example.org/> .
ex:User a <http://www.w3.org/2002/07/owl#Class> .
`;
        const triples = await collectTurtle(ttl);
        expect(triples.length).toBeGreaterThanOrEqual(1);
        expect((triples[0].subject as IRI).value).toBe("http://example.org/User");
    });

    it("parses SPARQL-style PREFIX declaration", async () => {
        const ttl = `
PREFIX ex: <http://example.org/>
ex:Foo a <http://www.w3.org/2002/07/owl#Class> .
`;
        const triples = await collectTurtle(ttl);
        expect(triples.length).toBeGreaterThanOrEqual(1);
    });

    it('parses keyword "a" as rdf:type', async () => {
        const ttl = `
@prefix ex: <http://example.org/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
ex:User a owl:Class .
`;
        const triples = await collectTurtle(ttl);
        expect(triples[0].predicate.value).toBe("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
    });

    it("parses predicate lists separated by semicolons", async () => {
        const ttl = `
@prefix ex: <http://example.org/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
ex:User rdf:type ex:Class ; ex:name "Alice" .
`;
        const triples = await collectTurtle(ttl);
        expect(triples).toHaveLength(2);
    });

    it("parses object lists separated by commas", async () => {
        const ttl = `
@prefix ex: <http://example.org/> .
ex:User ex:tag "a", "b", "c" .
`;
        const triples = await collectTurtle(ttl);
        expect(triples).toHaveLength(3);
    });

    it("parses string literals", async () => {
        const ttl = `
@prefix ex: <http://example.org/> .
ex:User ex:name "Alice" .
`;
        const triples = await collectTurtle(ttl);
        const obj = triples[0].object as Literal;
        expect(obj.termType).toBe("Literal");
        expect(obj.value).toBe("Alice");
    });

    it("parses language-tagged literals", async () => {
        const ttl = `
@prefix ex: <http://example.org/> .
ex:User ex:name "Bonjour"@fr .
`;
        const triples = await collectTurtle(ttl);
        const obj = triples[0].object as Literal;
        expect(obj.language).toBe("fr");
    });

    it("parses datatype literals", async () => {
        const ttl = `
@prefix ex: <http://example.org/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
ex:User ex:score "42"^^xsd:integer .
`;
        const triples = await collectTurtle(ttl);
        const obj = triples[0].object as Literal;
        expect(obj.termType).toBe("Literal");
        expect(obj.value).toBe("42");
        expect(obj.datatype.value).toContain("integer");
    });

    it("parses integer shorthand literals", async () => {
        const ttl = `
@prefix ex: <http://example.org/> .
ex:User ex:count 42 .
`;
        const triples = await collectTurtle(ttl);
        const obj = triples[0].object as Literal;
        expect(obj.termType).toBe("Literal");
        expect(obj.value).toBe("42");
    });

    it("parses decimal shorthand literals", async () => {
        const ttl = `
@prefix ex: <http://example.org/> .
ex:User ex:ratio 3.14 .
`;
        const triples = await collectTurtle(ttl);
        const obj = triples[0].object as Literal;
        expect(obj.termType).toBe("Literal");
        expect(obj.value).toBe("3.14");
    });

    it("parses boolean true literal", async () => {
        const ttl = `
@prefix ex: <http://example.org/> .
ex:User ex:active true .
`;
        const triples = await collectTurtle(ttl);
        const obj = triples[0].object as Literal;
        expect(obj.value).toBe("true");
    });

    it("parses boolean false literal", async () => {
        const ttl = `
@prefix ex: <http://example.org/> .
ex:User ex:active false .
`;
        const triples = await collectTurtle(ttl);
        const obj = triples[0].object as Literal;
        expect(obj.value).toBe("false");
    });

    it("parses named blank nodes", async () => {
        const ttl = `
@prefix ex: <http://example.org/> .
_:b0 ex:name "Alice" .
`;
        const triples = await collectTurtle(ttl);
        expect(triples[0].subject).toMatchObject({ termType: "BlankNode" });
    });

    it("parses anonymous blank nodes with inline property lists", async () => {
        const ttl = `
@prefix ex: <http://example.org/> .
ex:User ex:address [ ex:city "London" ] .
`;
        const triples = await collectTurtle(ttl);
        // 2 triples: one for ex:address pointing to blank, one for ex:city on blank
        expect(triples.length).toBeGreaterThanOrEqual(2);
    });

    it("parses triple-quoted string literals", async () => {
        const ttl = `
@prefix ex: <http://example.org/> .
ex:User ex:desc """Hello
World""" .
`;
        const triples = await collectTurtle(ttl);
        const obj = triples[0].object as Literal;
        expect(obj.value).toContain("Hello");
        expect(obj.value).toContain("World");
    });

    it("skips comments in Turtle", async () => {
        const ttl = `
# This is a comment
@prefix ex: <http://example.org/> .
# Another comment
ex:User a ex:Class . # trailing comment
`;
        const triples = await collectTurtle(ttl);
        expect(triples).toHaveLength(1);
    });

    it("throws on unknown prefix", async () => {
        await expect(collectTurtle("unknown:Foo a <http://x/Class> .\n")).rejects.toThrow();
    });

    it("parses negative numeric literals", async () => {
        const ttl = `
@prefix ex: <http://example.org/> .
ex:User ex:delta -5 .
`;
        const triples = await collectTurtle(ttl);
        const obj = triples[0].object as Literal;
        expect(obj.value).toBe("-5");
    });
});

// ── readShaclShapes / mergeShapes ─────────────────────────────────────────────

const SH = "http://www.w3.org/ns/shacl#";
const RDF_T = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

function shacl_iri(local: string): IRI {
    return new IRI(`${SH}${local}`);
}
function ex_iri(local: string): IRI {
    return new IRI(`http://example.org/${local}`);
}
function lit(v: string): { termType: "Literal"; value: string; datatype: IRI; language?: string } {
    return {
        termType: "Literal",
        value: v,
        datatype: new IRI("http://www.w3.org/2001/XMLSchema#string"),
    };
}

function shaclTriples(): Triple[] {
    const shapeIri = ex_iri("UserShape");
    const propBlank = blankNode("ps1");
    return [
        { subject: shapeIri, predicate: new IRI(RDF_T), object: shacl_iri("NodeShape") },
        { subject: shapeIri, predicate: shacl_iri("targetClass"), object: ex_iri("User") },
        { subject: shapeIri, predicate: shacl_iri("property"), object: propBlank },
        { subject: propBlank, predicate: shacl_iri("path"), object: ex_iri("email") },
        { subject: propBlank, predicate: shacl_iri("minCount"), object: lit("1") },
        { subject: propBlank, predicate: shacl_iri("maxCount"), object: lit("1") },
        {
            subject: propBlank,
            predicate: shacl_iri("datatype"),
            object: new IRI("http://www.w3.org/2001/XMLSchema#string"),
        },
        { subject: propBlank, predicate: shacl_iri("pattern"), object: lit(".+@.+") },
        {
            subject: propBlank,
            predicate: shacl_iri("message"),
            object: lit("Valid email required"),
        },
    ];
}

describe("readShaclShapes", () => {
    it("parses a NodeShape from triples", () => {
        const shapes = readShaclShapes(shaclTriples());
        expect(shapes.nodeShapes.size).toBe(1);
        const shape = shapes.nodeShapes.get("http://example.org/UserShape");
        expect(shape).toBeDefined();
        expect(shape?.targetClass).toBe("http://example.org/User");
    });

    it("parses property shapes correctly", () => {
        const shapes = readShaclShapes(shaclTriples());
        const shape = shapes.byTargetClass.get("http://example.org/User");
        if (shape == null) {
            throw new Error("expected User shape");
        }
        expect(shape.properties).toHaveLength(1);
        const ps = shape.properties[0];
        if (ps == null) {
            throw new Error("expected at least one property shape");
        }
        expect(ps.path).toBe("http://example.org/email");
        expect(ps.minCount).toBe(1);
        expect(ps.maxCount).toBe(1);
        expect(ps.pattern).toBe(".+@.+");
        expect(ps.message).toBe("Valid email required");
    });

    it("parses sh:datatype on property shapes", () => {
        const shapes = readShaclShapes(shaclTriples());
        const shape = shapes.byTargetClass.get("http://example.org/User");
        if (shape == null) {
            throw new Error("expected User shape");
        }
        expect(shape.properties[0]?.datatype).toContain("string");
    });

    it("parses sh:class constraint", () => {
        const shapeIri = ex_iri("OrgShape");
        const propBlank = blankNode("ps2");
        const triples: Triple[] = [
            { subject: shapeIri, predicate: new IRI(RDF_T), object: shacl_iri("NodeShape") },
            { subject: shapeIri, predicate: shacl_iri("targetClass"), object: ex_iri("Org") },
            { subject: shapeIri, predicate: shacl_iri("property"), object: propBlank },
            { subject: propBlank, predicate: shacl_iri("path"), object: ex_iri("member") },
            { subject: propBlank, predicate: shacl_iri("class"), object: ex_iri("User") },
        ];
        const shapes = readShaclShapes(triples);
        const orgShape = shapes.byTargetClass.get("http://example.org/Org");
        if (orgShape == null) {
            throw new Error("expected Org shape");
        }
        const ps = orgShape.properties[0];
        if (ps == null) {
            throw new Error("expected at least one property shape on Org");
        }
        expect(ps.classConstraint).toBe("http://example.org/User");
    });

    it("parses sh:closed = true", () => {
        const shapeIri = ex_iri("ClosedShape");
        const triples: Triple[] = [
            { subject: shapeIri, predicate: new IRI(RDF_T), object: shacl_iri("NodeShape") },
            { subject: shapeIri, predicate: shacl_iri("targetClass"), object: ex_iri("Item") },
            { subject: shapeIri, predicate: shacl_iri("closed"), object: lit("true") },
        ];
        const shapes = readShaclShapes(triples);
        const shape = shapes.nodeShapes.get("http://example.org/ClosedShape");
        if (shape == null) {
            throw new Error("expected ClosedShape node shape");
        }
        expect(shape.closed).toBe(true);
    });

    it("mergeShapes combines two shape sets", () => {
        const a = readShaclShapes(shaclTriples());
        const shapeIri = ex_iri("OtherShape");
        const propBlank = blankNode("ps3");
        const bTriples: Triple[] = [
            { subject: shapeIri, predicate: new IRI(RDF_T), object: shacl_iri("NodeShape") },
            { subject: shapeIri, predicate: shacl_iri("targetClass"), object: ex_iri("Other") },
            { subject: shapeIri, predicate: shacl_iri("property"), object: propBlank },
            { subject: propBlank, predicate: shacl_iri("path"), object: ex_iri("foo") },
        ];
        const b = readShaclShapes(bTriples);
        const merged = mergeShapes(a, b);
        expect(merged.nodeShapes.size).toBe(2);
        expect(merged.byTargetClass.size).toBe(2);
    });
});

// ── generateAugmentedTypes ────────────────────────────────────────────────────

describe("generateAugmentedTypes", () => {
    const LOCAL_NS = "http://local.example.org/";
    const BASE_NS = "http://example.org/";

    const baseTriples: Triple[] = [
        t(`${BASE_NS}User`, `${RDF}type`, `${OWL}Class`),
        t(`${BASE_NS}email`, `${RDF}type`, `${OWL}DatatypeProperty`),
        t(`${BASE_NS}email`, `${RDFS}domain`, `${BASE_NS}User`),
        t(`${BASE_NS}email`, `${RDFS}range`, `${XSD}string`),
    ];

    const localTriples: Triple[] = [
        t(`${LOCAL_NS}Project`, `${RDF}type`, `${OWL}Class`),
        t(`${LOCAL_NS}title`, `${RDF}type`, `${OWL}DatatypeProperty`),
        t(`${LOCAL_NS}title`, `${RDFS}domain`, `${LOCAL_NS}Project`),
        t(`${LOCAL_NS}title`, `${RDFS}range`, `${XSD}string`),
        // Extension property on base class
        t(`${LOCAL_NS}score`, `${RDF}type`, `${OWL}DatatypeProperty`),
        t(`${LOCAL_NS}score`, `${RDFS}domain`, `${BASE_NS}User`),
        t(`${LOCAL_NS}score`, `${RDFS}range`, `${XSD}integer`),
    ];

    const emptyShapes: ShaclShapes = { nodeShapes: new Map(), byTargetClass: new Map() };

    it("generates exported interfaces for local classes", () => {
        const ontology = readOntology([...baseTriples, ...localTriples]);
        const externalClasses = new Map([[`${BASE_NS}User`, "@system/auth"]]);
        const output = generateAugmentedTypes(ontology, emptyShapes, {
            externalClasses,
            localNamespace: LOCAL_NS,
        });
        expect(output).toContain("export interface Project");
        expect(output).toContain("title?:");
    });

    it("generates module augmentation for external classes with local properties", () => {
        const ontology = readOntology([...baseTriples, ...localTriples]);
        const externalClasses = new Map([[`${BASE_NS}User`, "@system/auth"]]);
        const output = generateAugmentedTypes(ontology, emptyShapes, {
            externalClasses,
            localNamespace: LOCAL_NS,
        });
        expect(output).toContain('declare module "@system/auth"');
        expect(output).toContain("score?:");
    });

    it("uses custom iriImport when specified", () => {
        const ontology = readOntology(localTriples);
        const output = generateAugmentedTypes(ontology, emptyShapes, {
            externalClasses: new Map(),
            localNamespace: LOCAL_NS,
            iriImport: "../semantics/IRI.js",
        });
        expect(output).toContain('from "../semantics/IRI.js"');
    });

    it("marks required fields when SHACL minCount >= 1", () => {
        const shapeIri = new IRI(`${LOCAL_NS}ProjectShape`);
        const propBlank = blankNode("reqps");
        const shaclTrips: Triple[] = [
            { subject: shapeIri, predicate: new IRI(RDF_T), object: shacl_iri("NodeShape") },
            {
                subject: shapeIri,
                predicate: shacl_iri("targetClass"),
                object: new IRI(`${LOCAL_NS}Project`),
            },
            { subject: shapeIri, predicate: shacl_iri("property"), object: propBlank },
            {
                subject: propBlank,
                predicate: shacl_iri("path"),
                object: new IRI(`${LOCAL_NS}title`),
            },
            { subject: propBlank, predicate: shacl_iri("minCount"), object: lit("1") },
        ];
        const shapes = readShaclShapes(shaclTrips);
        const ontology = readOntology(localTriples);
        const output = generateAugmentedTypes(ontology, shapes, {
            externalClasses: new Map(),
            localNamespace: LOCAL_NS,
        });
        // Required field should NOT have '?'
        expect(output).toContain("title:");
        expect(output).not.toContain("title?: ");
    });

    it("emits import for external type used as range", () => {
        // A local class with an object property whose range is the external User class.
        const rangeTriples: Triple[] = [
            ...baseTriples,
            t(`${LOCAL_NS}Project`, `${RDF}type`, `${OWL}Class`),
            t(`${LOCAL_NS}owner`, `${RDF}type`, `${OWL}ObjectProperty`),
            t(`${LOCAL_NS}owner`, `${RDFS}domain`, `${LOCAL_NS}Project`),
            t(`${LOCAL_NS}owner`, `${RDFS}range`, `${BASE_NS}User`),
        ];
        const ontology = readOntology(rangeTriples);
        const externalClasses = new Map([[`${BASE_NS}User`, "@jasonscharf/auth"]]);
        const output = generateAugmentedTypes(ontology, emptyShapes, {
            externalClasses,
            localNamespace: LOCAL_NS,
        });
        expect(output).toContain('import type { User } from "@jasonscharf/auth"');
    });

    it("does not import external classes that are only augmented, never used as a range", () => {
        // baseTriples/localTriples augment User (via `score`) but never use it as a range.
        const ontology = readOntology([...baseTriples, ...localTriples]);
        const externalClasses = new Map([[`${BASE_NS}User`, "@jasonscharf/auth"]]);
        const output = generateAugmentedTypes(ontology, emptyShapes, {
            externalClasses,
            localNamespace: LOCAL_NS,
        });
        expect(output).not.toContain("import type { User }");
        // The augmentation block is still emitted (it does not require an import).
        expect(output).toContain('declare module "@jasonscharf/auth"');
    });

    it("skips external classes that have no local-namespace properties", () => {
        const ontology = readOntology(baseTriples);
        const externalClasses = new Map([[`${BASE_NS}User`, "@system/auth"]]);
        const output = generateAugmentedTypes(ontology, emptyShapes, {
            externalClasses,
            localNamespace: LOCAL_NS,
        });
        // No local properties → no module augmentation block
        expect(output).not.toContain('declare module "@system/auth"');
    });
});

// ── generateShapesDescriptor ──────────────────────────────────────────────────

describe("generateShapesDescriptor", () => {
    it("generates a shapes descriptor with the shape list", () => {
        const shapes = readShaclShapes(shaclTriples());
        const output = generateShapesDescriptor(shapes);
        expect(output).toContain("auto-generated shapes descriptor");
        expect(output).toContain("UserShape");
        expect(output).toContain("http://example.org/User");
        expect(output).toContain("export const shapes:");
    });

    it("includes all PropertyShape fields in the output", () => {
        const shapes = readShaclShapes(shaclTriples());
        const output = generateShapesDescriptor(shapes);
        expect(output).toContain("minCount:");
        expect(output).toContain("maxCount:");
        expect(output).toContain("datatype:");
        expect(output).toContain("pattern:");
        expect(output).toContain("message:");
    });

    it("generates valid output for empty shapes", () => {
        const empty: ShaclShapes = { nodeShapes: new Map(), byTargetClass: new Map() };
        const output = generateShapesDescriptor(empty);
        expect(output).toContain("const list: ShaclNodeShape[]");
        expect(output).toContain("export const shapes:");
    });
});

// ── generateFromConfig ────────────────────────────────────────────────────────

describe("generateFromConfig", () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), "tern-cfg-"));
    });
    afterEach(async () => {
        await rm(tmpDir, { recursive: true });
    });

    it("generates a types file from a minimal config", async () => {
        const ntPath = join(tmpDir, "base.nt");
        await writeFile(
            ntPath,
            `<http://base.example.org/User> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://www.w3.org/2002/07/owl#Class> .\n`,
        );

        const extPath = join(tmpDir, "ext.nt");
        await writeFile(
            extPath,
            `<http://local.example.org/Project> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://www.w3.org/2002/07/owl#Class> .\n`,
        );

        const outPath = join(tmpDir, "out", "types.ts");

        const config = {
            bases: [{ ontology: "base.nt", package: "@system/auth" }],
            extensions: ["ext.nt"],
            localNamespace: "http://local.example.org/",
            out: "out/types.ts",
        };
        const configPath = join(tmpDir, "tern-gen.json");
        await writeFile(configPath, JSON.stringify(config));

        await generateFromConfig(configPath);

        const output = await readFile(outPath, "utf-8");
        expect(output).toContain("export interface Project");
    });

    it("generates a shapes descriptor when shapesOut is set", async () => {
        const extPath = join(tmpDir, "ext.nt");
        await writeFile(
            extPath,
            `<http://local.example.org/Task> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://www.w3.org/2002/07/owl#Class> .\n`,
        );

        const shaclPath = join(tmpDir, "shapes.nt");
        const taskShapeIri = "http://local.example.org/TaskShape";
        const propBlankId = "shps1";
        await writeFile(
            shaclPath,
            `${[
                `<${taskShapeIri}> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://www.w3.org/ns/shacl#NodeShape> .`,
                `<${taskShapeIri}> <http://www.w3.org/ns/shacl#targetClass> <http://local.example.org/Task> .`,
                `<${taskShapeIri}> <http://www.w3.org/ns/shacl#property> _:${propBlankId} .`,
                `_:${propBlankId} <http://www.w3.org/ns/shacl#path> <http://local.example.org/title> .`,
                `_:${propBlankId} <http://www.w3.org/ns/shacl#minCount> "1" .`,
            ].join("\n")}\n`,
        );

        const config = {
            bases: [],
            extensions: ["ext.nt"],
            shapes: ["shapes.nt"],
            localNamespace: "http://local.example.org/",
            out: "types.ts",
            shapesOut: "shapes.generated.ts",
        };
        const configPath = join(tmpDir, "tern-gen.json");
        await writeFile(configPath, JSON.stringify(config));

        await generateFromConfig(configPath);

        const shapesOut = await readFile(join(tmpDir, "shapes.generated.ts"), "utf-8");
        expect(shapesOut).toContain("TaskShape");
    });

    it("generates from Turtle extension files when shapesOut not set", async () => {
        const ttlPath = join(tmpDir, "ext.ttl");
        await writeFile(
            ttlPath,
            [
                "@prefix owl: <http://www.w3.org/2002/07/owl#> .",
                "@prefix local: <http://local.example.org/> .",
                "local:Widget a owl:Class .",
            ].join("\n"),
        );

        const config = {
            bases: [],
            extensions: ["ext.ttl"],
            localNamespace: "http://local.example.org/",
            out: "types.ts",
        };
        const configPath = join(tmpDir, "tern-gen.json");
        await writeFile(configPath, JSON.stringify(config));

        await generateFromConfig(configPath);

        const output = await readFile(join(tmpDir, "types.ts"), "utf-8");
        expect(output).toContain("Widget");
    });

    it("uses base.importPath when explicitly provided (left branch of ?? at importPath)", async () => {
        const ntPath = join(tmpDir, "base.nt");
        await writeFile(
            ntPath,
            `<http://base.example.org/User> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://www.w3.org/2002/07/owl#Class> .\n`,
        );
        // A local class that uses the base User as an object-property range, so the
        // external import (and thus base.importPath) appears in the output.
        const extPath = join(tmpDir, "ext.nt");
        await writeFile(
            extPath,
            `${[
                `<http://local.example.org/Project> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://www.w3.org/2002/07/owl#Class> .`,
                `<http://local.example.org/owner> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://www.w3.org/2002/07/owl#ObjectProperty> .`,
                `<http://local.example.org/owner> <http://www.w3.org/2000/01/rdf-schema#domain> <http://local.example.org/Project> .`,
                `<http://local.example.org/owner> <http://www.w3.org/2000/01/rdf-schema#range> <http://base.example.org/User> .`,
            ].join("\n")}\n`,
        );
        const config = {
            bases: [
                { ontology: "base.nt", package: "@system/auth", importPath: "@system/auth/types" },
            ],
            extensions: ["ext.nt"],
            localNamespace: "http://local.example.org/",
            out: "out/types.ts",
        };
        const configPath = join(tmpDir, "tern-gen.json");
        await writeFile(configPath, JSON.stringify(config));
        await generateFromConfig(configPath);
        const output = await readFile(join(tmpDir, "out", "types.ts"), "utf-8");
        expect(output).toContain("@system/auth/types");
    });

    it("handles config with no extensions array (uses ?? [] fallback)", async () => {
        const ntPath = join(tmpDir, "base.nt");
        await writeFile(
            ntPath,
            `<http://base.example.org/User> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://www.w3.org/2002/07/owl#Class> .\n`,
        );
        const configPath = join(tmpDir, "tern-gen.json");
        // Note: no "extensions" key → config.extensions is undefined → ?? [] fallback
        await writeFile(
            configPath,
            JSON.stringify({
                bases: [{ ontology: "base.nt", package: "@system/auth" }],
                localNamespace: "http://base.example.org/",
                out: "types.ts",
            }),
        );
        await generateFromConfig(configPath);
        const output = await readFile(join(tmpDir, "types.ts"), "utf-8");
        expect(output).toContain("// auto-generated");
    });
});

// ── ShaclValidator (validate) ─────────────────────────────────────────────────

describe("validate", () => {
    const xsd = "http://www.w3.org/2001/XMLSchema#";

    function makeShape(
        props: Array<{
            path: string;
            minCount?: number;
            maxCount?: number;
            datatype?: string;
            pattern?: string;
            message?: string;
        }>,
    ) {
        return {
            iri: "http://example.org/TestShape",
            targetClass: "http://example.org/Test",
            closed: false,
            properties: props.map(({ path: propPath, ...rest }) => ({
                path: `http://example.org/${propPath}`,
                ...rest,
            })),
        };
    }

    const propMap = (names: string[]) =>
        Object.fromEntries(names.map((n) => [n, `http://example.org/${n}`]));

    it("returns valid when all required fields are present", () => {
        const shape = makeShape([{ path: "email", minCount: 1 }]);
        const result = validate({ email: "alice@test.com" }, shape, propMap(["email"]));
        expect(result.valid).toBe(true);
        expect(result.violations).toHaveLength(0);
    });

    it("reports violation when required field is missing", () => {
        const shape = makeShape([{ path: "email", minCount: 1 }]);
        const result = validate({}, shape, propMap(["email"]));
        expect(result.valid).toBe(false);
        expect(result.violations[0]?.property).toBe("email");
    });

    it("reports violation when maxCount is exceeded", () => {
        const shape = makeShape([{ path: "tag", maxCount: 1 }]);
        const result = validate({ tag: ["a", "b"] }, shape, propMap(["tag"]));
        expect(result.valid).toBe(false);
        expect(result.violations[0]?.message).toContain("at most");
    });

    it("reports violation when pattern does not match", () => {
        const shape = makeShape([{ path: "email", pattern: ".+@.+" }]);
        const result = validate({ email: "not-an-email" }, shape, propMap(["email"]));
        expect(result.valid).toBe(false);
        expect(result.violations[0]?.property).toBe("email");
    });

    it("does not report pattern violation when value matches", () => {
        const shape = makeShape([{ path: "email", pattern: ".+@.+" }]);
        const result = validate({ email: "alice@test.com" }, shape, propMap(["email"]));
        expect(result.valid).toBe(true);
    });

    it("reports datatype violation for string field with non-string value", () => {
        const shape = makeShape([{ path: "name", datatype: `${xsd}string` }]);
        const result = validate({ name: 42 }, shape, propMap(["name"]));
        expect(result.valid).toBe(false);
    });

    it("passes datatype check for correct string value", () => {
        const shape = makeShape([{ path: "name", datatype: `${xsd}string` }]);
        const result = validate({ name: "hello" }, shape, propMap(["name"]));
        expect(result.valid).toBe(true);
    });

    it("reports datatype violation for boolean field with wrong type", () => {
        const shape = makeShape([{ path: "active", datatype: `${xsd}boolean` }]);
        const result = validate({ active: "yes" }, shape, propMap(["active"]));
        expect(result.valid).toBe(false);
    });

    it("passes datatype check for correct boolean", () => {
        const shape = makeShape([{ path: "active", datatype: `${xsd}boolean` }]);
        const result = validate({ active: true }, shape, propMap(["active"]));
        expect(result.valid).toBe(true);
    });

    it("reports datatype violation for integer field with non-number", () => {
        const shape = makeShape([{ path: "count", datatype: `${xsd}integer` }]);
        const result = validate({ count: "five" }, shape, propMap(["count"]));
        expect(result.valid).toBe(false);
    });

    it("passes datatype check for correct integer", () => {
        const shape = makeShape([{ path: "count", datatype: `${xsd}integer` }]);
        const result = validate({ count: 5 }, shape, propMap(["count"]));
        expect(result.valid).toBe(true);
    });

    it("reports datatype violation for dateTime field with wrong type", () => {
        const shape = makeShape([{ path: "createdAt", datatype: `${xsd}dateTime` }]);
        const result = validate({ createdAt: 12345 }, shape, propMap(["createdAt"]));
        expect(result.valid).toBe(false);
    });

    it("passes dateTime check for Date objects", () => {
        const shape = makeShape([{ path: "createdAt", datatype: `${xsd}dateTime` }]);
        const result = validate({ createdAt: new Date() }, shape, propMap(["createdAt"]));
        expect(result.valid).toBe(true);
    });

    it("passes dateTime check for ISO date strings", () => {
        const shape = makeShape([{ path: "createdAt", datatype: `${xsd}dateTime` }]);
        const result = validate(
            { createdAt: new Date().toISOString() },
            shape,
            propMap(["createdAt"]),
        );
        expect(result.valid).toBe(true);
    });

    it("uses custom message from sh:message when set", () => {
        const shape = makeShape([{ path: "email", minCount: 1, message: "Email is required." }]);
        const result = validate({}, shape, propMap(["email"]));
        expect(result.violations[0]?.message).toBe("Email is required.");
    });

    it("uses IRI path as property name when not in propertyMap", () => {
        const shape = makeShape([{ path: "unknownProp", minCount: 1 }]);
        const result = validate({}, shape, {});
        // Property name falls back to the IRI path
        expect(result.violations[0]?.property).toContain("unknownProp");
    });

    it("handles array values for maxCount check", () => {
        const shape = makeShape([{ path: "tags", maxCount: 2 }]);
        const result = validate({ tags: ["a", "b", "c"] }, shape, propMap(["tags"]));
        expect(result.valid).toBe(false);
    });

    it("handles array values within maxCount limit", () => {
        const shape = makeShape([{ path: "tags", maxCount: 3 }]);
        const result = validate({ tags: ["a", "b"] }, shape, propMap(["tags"]));
        expect(result.valid).toBe(true);
    });

    it("validates decimal datatype", () => {
        const shape = makeShape([{ path: "price", datatype: `${xsd}decimal` }]);
        expect(validate({ price: 9.99 }, shape, propMap(["price"])).valid).toBe(true);
        expect(validate({ price: "nine" }, shape, propMap(["price"])).valid).toBe(false);
    });

    it("validates float datatype", () => {
        const shape = makeShape([{ path: "ratio", datatype: `${xsd}float` }]);
        expect(validate({ ratio: 0.5 }, shape, propMap(["ratio"])).valid).toBe(true);
        expect(validate({ ratio: false }, shape, propMap(["ratio"])).valid).toBe(false);
    });

    it("validates double datatype", () => {
        const shape = makeShape([{ path: "val", datatype: `${xsd}double` }]);
        expect(validate({ val: 3.14 }, shape, propMap(["val"])).valid).toBe(true);
    });

    it("validates date datatype (string)", () => {
        const shape = makeShape([{ path: "dob", datatype: `${xsd}date` }]);
        expect(validate({ dob: "2000-01-01" }, shape, propMap(["dob"])).valid).toBe(true);
    });

    it("skips pattern check for non-string values", () => {
        const shape = makeShape([{ path: "count", pattern: "^\\d+$" }]);
        // Non-string values are not pattern-checked per the implementation
        const result = validate({ count: 42 }, shape, propMap(["count"]));
        expect(result.violations).toHaveLength(0);
    });
});

// ── TurtleParser: escape sequences + _expect error ────────────────────────────

describe("parseTurtle — escape sequences in string literals", () => {
    it("parses \\n escape in single-quoted Turtle string", async () => {
        const ttl = `@prefix ex: <http://example.org/> .\nex:User ex:name "line\\nbreak" .\n`;
        const triples = await collectTurtle(ttl);
        expect((triples[0].object as Literal).value).toBe("line\nbreak");
    });

    it("parses \\t escape in Turtle string", async () => {
        const ttl = `@prefix ex: <http://example.org/> .\nex:User ex:name "col1\\tcol2" .\n`;
        const triples = await collectTurtle(ttl);
        expect((triples[0].object as Literal).value).toBe("col1\tcol2");
    });

    it("parses \\r escape in Turtle string", async () => {
        const ttl = `@prefix ex: <http://example.org/> .\nex:User ex:name "a\\rb" .\n`;
        const triples = await collectTurtle(ttl);
        expect((triples[0].object as Literal).value).toBe("a\rb");
    });

    it('parses \\" escape in Turtle string', async () => {
        const ttl = `@prefix ex: <http://example.org/> .\nex:User ex:name "say \\"hi\\"" .\n`;
        const triples = await collectTurtle(ttl);
        expect((triples[0].object as Literal).value).toBe('say "hi"');
    });

    it("parses \\' escape in Turtle string", async () => {
        const ttl = `@prefix ex: <http://example.org/> .\nex:User ex:name "it\\'s" .\n`;
        const triples = await collectTurtle(ttl);
        expect((triples[0].object as Literal).value).toBe("it's");
    });

    it("parses \\\\ escape in Turtle string", async () => {
        const ttl = `@prefix ex: <http://example.org/> .\nex:User ex:name "back\\\\slash" .\n`;
        const triples = await collectTurtle(ttl);
        expect((triples[0].object as Literal).value).toBe("back\\slash");
    });

    it("passes through unknown escape sequence via _unescape default branch", async () => {
        const ttl = `@prefix ex: <http://example.org/> .\nex:User ex:name "\\z" .\n`;
        const triples = await collectTurtle(ttl);
        expect((triples[0].object as Literal).value).toBe("z");
    });

    it("throws on unclosed IRI (triggers _expect error)", async () => {
        const ttl = `@prefix ex: <http://example.org/> .\nex:User a <http://unclosed\n`;
        await expect(collectTurtle(ttl)).rejects.toThrow();
    });

    it("parses BASE declaration (line 94 branch)", async () => {
        const ttl = `BASE <http://base.example.org/>\n@prefix ex: <http://example.org/> .\nex:User a ex:Class .\n`;
        const triples = await collectTurtle(ttl);
        expect(triples).toHaveLength(1);
    });

    it("parses anonymous blank node as subject (line 115 branch)", async () => {
        const ttl = `@prefix ex: <http://example.org/> .\n[ ex:name "Alice" ] .\n`;
        const triples = await collectTurtle(ttl);
        expect(triples).toHaveLength(1);
        expect((triples[0].object as Literal).value).toBe("Alice");
    });

    it("handles trailing semicolon before dot (line 133 branch)", async () => {
        const ttl = `@prefix ex: <http://example.org/> .\nex:User a ex:Class ; .\n`;
        const triples = await collectTurtle(ttl);
        expect(triples).toHaveLength(1);
    });

    it("parses full IRI as predicate (line 240 _parseIRI branch)", async () => {
        const ttl = `@prefix ex: <http://example.org/> .\nex:User <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> ex:Class .\n`;
        const triples = await collectTurtle(ttl);
        expect(triples).toHaveLength(1);
        expect((triples[0].predicate as IRI).value).toBe(
            "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
        );
    });

    it("parses @base directive (lines 70-75 branch)", async () => {
        const ttl = `@base <http://base.example.org/> .\n@prefix ex: <http://example.org/> .\nex:User a ex:Class .\n`;
        const triples = await collectTurtle(ttl);
        expect(triples).toHaveLength(1);
    });

    it("throws on unknown @-directive (line 77 throw branch)", async () => {
        const ttl = `@unknown <http://example.org/> .\n`;
        await expect(collectTurtle(ttl)).rejects.toThrow();
    });
});

// ── TypeGenerator: uncovered branches ─────────────────────────────────────────

describe("generateAugmentedTypes — additional branch coverage", () => {
    const LOCAL_NS = "http://local.example.org/";
    const BASE_NS = "http://example.org/";
    const emptyShapes: ShaclShapes = { nodeShapes: new Map(), byTargetClass: new Map() };

    it("renders class-level comment in local interface (line 145 branch)", () => {
        const xsdString = iri(`${XSD}string`);
        const localTriples: Triple[] = [
            t(`${LOCAL_NS}Widget`, `${RDF}type`, `${OWL}Class`),
            {
                subject: iri(`${LOCAL_NS}Widget`),
                predicate: iri(`${RDFS}comment`),
                object: literal("A widget entity.", xsdString),
            },
        ];
        const output = generateAugmentedTypes(readOntology(localTriples), emptyShapes, {
            externalClasses: new Map(),
            localNamespace: LOCAL_NS,
        });
        expect(output).toContain("/** A widget entity. */");
    });

    it("renders property comment in local interface (line 93 branch)", () => {
        const xsdString = iri(`${XSD}string`);
        const localTriples: Triple[] = [
            t(`${LOCAL_NS}Widget`, `${RDF}type`, `${OWL}Class`),
            t(`${LOCAL_NS}label`, `${RDF}type`, `${OWL}DatatypeProperty`),
            t(`${LOCAL_NS}label`, `${RDFS}domain`, `${LOCAL_NS}Widget`),
            t(`${LOCAL_NS}label`, `${RDFS}range`, `${XSD}string`),
            {
                subject: iri(`${LOCAL_NS}label`),
                predicate: iri(`${RDFS}comment`),
                object: literal("The display label.", xsdString),
            },
        ];
        const output = generateAugmentedTypes(readOntology(localTriples), emptyShapes, {
            externalClasses: new Map(),
            localNamespace: LOCAL_NS,
        });
        expect(output).toContain("/** The display label. */");
    });

    it("skips external class not present in externalClasses map (line 165 continue branch)", () => {
        const baseTriples: Triple[] = [
            t(`${BASE_NS}User`, `${RDF}type`, `${OWL}Class`),
            t(`${BASE_NS}email`, `${RDF}type`, `${OWL}DatatypeProperty`),
            t(`${BASE_NS}email`, `${RDFS}domain`, `${BASE_NS}User`),
            t(`${BASE_NS}email`, `${RDFS}range`, `${XSD}string`),
        ];
        const localTriples: Triple[] = [t(`${LOCAL_NS}Project`, `${RDF}type`, `${OWL}Class`)];
        const ontology = readOntology([...baseTriples, ...localTriples]);
        // User is in BASE_NS (external), but externalClasses map is empty → !pkg → continue
        const output = generateAugmentedTypes(ontology, emptyShapes, {
            externalClasses: new Map(),
            localNamespace: LOCAL_NS,
        });
        expect(output).toContain("export interface Project");
        expect(output).not.toContain("declare module");
    });

    it("object property with SHACL maxCount=1 is not an array (shaclMaxCount line 76)", () => {
        const localTriples: Triple[] = [
            t(`${LOCAL_NS}Task`, `${RDF}type`, `${OWL}Class`),
            t(`${LOCAL_NS}assignee`, `${RDF}type`, `${OWL}ObjectProperty`),
            t(`${LOCAL_NS}assignee`, `${RDFS}domain`, `${LOCAL_NS}Task`),
            t(`${LOCAL_NS}assignee`, `${RDFS}range`, `${LOCAL_NS}Task`),
        ];
        const shapeIri = new IRI(`${LOCAL_NS}TaskShape`);
        const propBlank = blankNode("mcps1");
        const shaclTrips: Triple[] = [
            { subject: shapeIri, predicate: new IRI(RDF_T), object: shacl_iri("NodeShape") },
            {
                subject: shapeIri,
                predicate: shacl_iri("targetClass"),
                object: new IRI(`${LOCAL_NS}Task`),
            },
            { subject: shapeIri, predicate: shacl_iri("property"), object: propBlank },
            {
                subject: propBlank,
                predicate: shacl_iri("path"),
                object: new IRI(`${LOCAL_NS}assignee`),
            },
            { subject: propBlank, predicate: shacl_iri("maxCount"), object: lit("1") },
        ];
        const shapes = readShaclShapes(shaclTrips);
        const ontology = readOntology(localTriples);
        const output = generateAugmentedTypes(ontology, shapes, {
            externalClasses: new Map(),
            localNamespace: LOCAL_NS,
        });
        // maxCount=1 → NOT an array → no "[]" suffix on the property
        expect(output).toContain("assignee?:");
        expect(output).not.toContain("assignee?: Task[]");
    });
});
