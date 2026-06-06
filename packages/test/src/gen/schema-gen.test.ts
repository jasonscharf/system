/**
 * SchemaGenerator tests.
 *
 * generateSchemas() emits runtime EntitySchema constants from an ontology +
 * SHACL shapes, splitting owl:DatatypeProperty → `properties` (literals) and
 * owl:ObjectProperty → `edges` (topology).  This is the mechanism that makes
 * foreign-key destruction generator-driven.
 */

import type { Triple } from "@jasonscharf/core";
import {
    generateSchemas,
    mergeShapes,
    parseTurtle,
    readOntology,
    readShaclShapes,
    type ShaclShapes,
} from "@jasonscharf/gen";
import { describe, expect, it } from "vitest";

async function triples(turtle: string): Promise<Triple[]> {
    const out: Triple[] = [];
    for await (const t of parseTurtle(turtle)) {
        out.push(t);
    }
    return out;
}

const PREFIXES = `
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix owl:  <http://www.w3.org/2002/07/owl#> .
@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .
@prefix sh:   <http://www.w3.org/ns/shacl#> .
@prefix lib:  <http://ex.org/lib/> .
@prefix auth: <http://ex.org/auth/> .
@prefix shapes: <http://ex.org/lib/shapes/> .
`;

describe("generateSchemas", () => {
    it("splits datatype properties into properties and object properties into edges", async () => {
        const ontology = readOntology(
            await triples(`${PREFIXES}
            lib:Author a owl:Class .
            lib:Book a owl:Class .
            lib:name a owl:DatatypeProperty ; rdfs:domain lib:Author ; rdfs:range xsd:string .
            lib:title a owl:DatatypeProperty ; rdfs:domain lib:Book ; rdfs:range xsd:string .
            lib:writtenBy a owl:ObjectProperty ; rdfs:domain lib:Book ; rdfs:range lib:Author .
            lib:reviewedBy a owl:ObjectProperty ; rdfs:domain lib:Book ; rdfs:range lib:Author .
        `),
        );
        const shapes: ShaclShapes = readShaclShapes(
            await triples(`${PREFIXES}
            shapes:BookShape a sh:NodeShape ;
                sh:targetClass lib:Book ;
                sh:property [ sh:path lib:title ; sh:datatype xsd:string ] ;
                sh:property [ sh:path lib:writtenBy ; sh:class lib:Author ; sh:maxCount 1 ] ;
                sh:property [ sh:path lib:reviewedBy ; sh:class lib:Author ] .
        `),
        );

        const src = generateSchemas(ontology, shapes, {
            localNamespace: "http://ex.org/lib/",
            iriImport: "@jasonscharf/core",
        });

        // Datatype properties → properties; no fooId.
        expect(src).toContain("export const BookSchema = new EntitySchema({");
        expect(src).toContain('typeIRI: new IRI("http://ex.org/lib/Book")');
        expect(src).toContain('title: new IRI("http://ex.org/lib/title")');

        // Object property with maxCount 1 → "one" edge via a forward thunk.
        expect(src).toContain(
            'writtenBy: { predicate: new IRI("http://ex.org/lib/writtenBy"), target: () => AuthorSchema, cardinality: "one", direction: "out" }',
        );
        // Object property without maxCount → "many".
        expect(src).toContain(
            'reviewedBy: { predicate: new IRI("http://ex.org/lib/reviewedBy"), target: () => AuthorSchema, cardinality: "many", direction: "out" }',
        );

        // Author has only a literal property, so no edges block.
        const authorBlock = src.slice(src.indexOf("AuthorSchema"));
        expect(authorBlock).toContain('name: new IRI("http://ex.org/lib/name")');
        expect(src.indexOf("AuthorSchema = new EntitySchema")).toBeGreaterThan(-1);
    });

    it("imports an external schema for a cross-package edge target", async () => {
        const ontology = readOntology(
            await triples(`${PREFIXES}
            lib:Book a owl:Class .
            lib:ownedBy a owl:ObjectProperty ; rdfs:domain lib:Book ; rdfs:range auth:User .
        `),
        );
        const src = generateSchemas(
            ontology,
            mergeShapes(
                { nodeShapes: new Map(), byTargetClass: new Map() },
                { nodeShapes: new Map(), byTargetClass: new Map() },
            ),
            {
                localNamespace: "http://ex.org/lib/",
                iriImport: "@jasonscharf/core",
                schemaImports: new Map([
                    [
                        "http://ex.org/auth/User",
                        { importPath: "@jasonscharf/auth", schemaName: "UserSchema" },
                    ],
                ]),
            },
        );

        expect(src).toContain('import { UserSchema } from "@jasonscharf/auth";');
        expect(src).toContain("target: () => UserSchema");
    });

    it("leaves a breadcrumb for an unmapped external edge target", async () => {
        const ontology = readOntology(
            await triples(`${PREFIXES}
            lib:Book a owl:Class .
            lib:ownedBy a owl:ObjectProperty ; rdfs:domain lib:Book ; rdfs:range auth:User .
        `),
        );
        const src = generateSchemas(
            ontology,
            { nodeShapes: new Map(), byTargetClass: new Map() },
            {
                localNamespace: "http://ex.org/lib/",
            },
        );
        expect(src).toContain("// ownedBy: edge target");
        expect(src).not.toContain("target: () =>");
    });
});
