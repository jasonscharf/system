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
        expect(src).toContain("export const BookSchema: EntitySchema = new EntitySchema({");
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
        expect(src).toContain("export const AuthorSchema: EntitySchema = new EntitySchema({");
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

    it("emits an unmapped external edge target as a targetless link with a breadcrumb", async () => {
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
        expect(src).toContain('ownedBy: { predicate: new IRI("http://ex.org/lib/ownedBy")');
        expect(src).toContain('// target "http://ex.org/auth/User" unmapped');
        expect(src).not.toContain("target: () =>");
    });

    it("emits a polymorphic edge (no rdfs:range) as a targetless link", async () => {
        const ontology = readOntology(
            await triples(`${PREFIXES}
            lib:Grant a owl:Class .
            lib:principal a owl:ObjectProperty ; rdfs:domain lib:Grant .
        `),
        );
        const src = generateSchemas(
            ontology,
            { nodeShapes: new Map(), byTargetClass: new Map() },
            {
                localNamespace: "http://ex.org/lib/",
            },
        );
        expect(src).toContain(
            'principal: { predicate: new IRI("http://ex.org/lib/principal"), cardinality: "many", direction: "out" }',
        );
        expect(src).not.toContain("target: () =>");
    });

    it("emits a containment edge and no module-scope registration for a contains-marked property", async () => {
        const ontology = readOntology(
            await triples(`${PREFIXES}
            @prefix sys: <urn:sys:core:> .
            lib:Forum a owl:Class .
            lib:Post a owl:Class .
            lib:hasPost a owl:ObjectProperty ;
                rdfs:subPropertyOf sys:contains ;
                rdfs:domain lib:Forum ; rdfs:range lib:Post .
        `),
        );
        const src = generateSchemas(
            ontology,
            { nodeShapes: new Map(), byTargetClass: new Map() },
            {
                localNamespace: "http://ex.org/lib/",
            },
        );

        // The contains-marked object property becomes a containment edge.
        expect(src).toContain(
            'hasPost: { predicate: new IRI("http://ex.org/lib/hasPost"), target: () => PostSchema, cardinality: "many", direction: "out", containment: true }',
        );
        // The flag is declarative data only: the generated file registers nothing
        // and runs no import-time side effect, so no import order can change the
        // authorization scope chain (TRN-627).
        expect(src).not.toContain("registerTopology");
        expect(src).not.toContain("@jasonscharf/server");
    });

    it("does not emit containment when no property is contains-marked", async () => {
        const ontology = readOntology(
            await triples(`${PREFIXES}
            lib:Forum a owl:Class .
            lib:Post a owl:Class .
            lib:hasPost a owl:ObjectProperty ; rdfs:domain lib:Forum ; rdfs:range lib:Post .
        `),
        );
        const src = generateSchemas(
            ontology,
            { nodeShapes: new Map(), byTargetClass: new Map() },
            {
                localNamespace: "http://ex.org/lib/",
            },
        );
        expect(src).not.toContain("containment: true");
        expect(src).not.toContain("registerTopology");
    });

    it("generates an augmented view schema for an external class that gains a local edge", async () => {
        // hasExperiment attaches a containment edge onto an external (base) class,
        // tenancy:Domain — the generator emits a DomainSchema view carrying the
        // class's own data props plus that edge (referencing the local
        // ExperimentSchema by thunk), but NOT the base object prop domainTenant.
        const ontology = readOntology(
            await triples(`${PREFIXES}
            @prefix sys: <urn:sys:core:> .
            @prefix tenancy: <urn:sys:core:tenancy:> .
            tenancy:Domain a owl:Class .
            tenancy:Tenant a owl:Class .
            tenancy:domainName a owl:DatatypeProperty ; rdfs:domain tenancy:Domain ; rdfs:range xsd:string .
            tenancy:domainTenant a owl:ObjectProperty ; rdfs:domain tenancy:Domain ; rdfs:range tenancy:Tenant .
            lib:Experiment a owl:Class .
            lib:hasExperiment a owl:ObjectProperty ;
                rdfs:subPropertyOf sys:contains ;
                rdfs:domain tenancy:Domain ; rdfs:range lib:Experiment .
        `),
        );
        const src = generateSchemas(
            ontology,
            { nodeShapes: new Map(), byTargetClass: new Map() },
            {
                localNamespace: "http://ex.org/lib/",
                idSegments: { Domain: "domain" },
            },
        );

        // A DomainSchema view is emitted with the external class's own namespace…
        expect(src).toContain("export const DomainSchema: EntitySchema = new EntitySchema({");
        expect(src).toContain('typeIRI: new IRI("urn:sys:core:tenancy:Domain")');
        expect(src).toContain('ns: "urn:sys:core:tenancy:"');
        expect(src).toContain('idSegment: "domain"');
        // …carrying the class's own data property…
        expect(src).toContain('domainName: new IRI("urn:sys:core:tenancy:domainName")');
        // …and the locally-declared containment edge…
        expect(src).toContain(
            'hasExperiment: { predicate: new IRI("http://ex.org/lib/hasExperiment"), target: () => ExperimentSchema, cardinality: "many", direction: "out", containment: true }',
        );
        // …but not the base object property (its edge belongs to Domain's canonical schema).
        const domainBlock = src.slice(src.indexOf("DomainSchema"), src.indexOf("ExperimentSchema"));
        expect(domainBlock).not.toContain("domainTenant");
        // The view's edge target is generated here, so it is a thunk, not an import.
        expect(src).not.toContain("import { ExperimentSchema }");
        expect(src).not.toContain("registerTopology");
    });
});
