import type { RdfObject, Triple } from "@jasonscharf/core";
import { IRI } from "@jasonscharf/core";

const RDF_TYPE = new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const OWL_CLASS = new IRI("http://www.w3.org/2002/07/owl#Class");
const OWL_DATATYPE_PROP = new IRI("http://www.w3.org/2002/07/owl#DatatypeProperty");
const OWL_OBJECT_PROP = new IRI("http://www.w3.org/2002/07/owl#ObjectProperty");
const RDFS_DOMAIN = new IRI("http://www.w3.org/2000/01/rdf-schema#domain");
const RDFS_RANGE = new IRI("http://www.w3.org/2000/01/rdf-schema#range");
const RDFS_LABEL = new IRI("http://www.w3.org/2000/01/rdf-schema#label");
const RDFS_COMMENT = new IRI("http://www.w3.org/2000/01/rdf-schema#comment");

export interface OntologyProperty {
    iri: string;
    name: string;
    range: string | null;
    comment: string | null;
    kind: "data" | "object";
}

export interface OntologyClass {
    iri: string;
    name: string;
    comment: string | null;
    properties: OntologyProperty[];
}

export interface Ontology {
    classes: Map<string, OntologyClass>;
    properties: Map<string, OntologyProperty>;
}

function localName(iri: string): string {
    const hash = iri.lastIndexOf("#");
    const slash = iri.lastIndexOf("/");
    const colon = iri.lastIndexOf(":");
    return iri.slice(Math.max(hash, slash, colon) + 1);
}

function asIRI(obj: RdfObject): IRI | null {
    return obj instanceof IRI ? obj : null;
}

function literalValue(obj: RdfObject): string | null {
    if (obj instanceof IRI) {
        return null;
    }
    if ("termType" in obj && obj.termType === "Literal") {
        return obj.value;
    }
    return null;
}

export function readOntology(triples: Triple[]): Ontology {
    const classes = new Map<string, OntologyClass>();
    const properties = new Map<string, OntologyProperty>();

    // First pass: identify classes and properties
    for (const { subject, predicate, object } of triples) {
        if (!(subject instanceof IRI)) {
            continue;
        }
        const subjectIRI = subject.value;

        if (!predicate.equals(RDF_TYPE)) {
            continue;
        }

        const objIRI = asIRI(object);
        if (!objIRI) {
            continue;
        }

        if (objIRI.equals(OWL_CLASS)) {
            if (!classes.has(subjectIRI)) {
                classes.set(subjectIRI, {
                    iri: subjectIRI,
                    name: localName(subjectIRI),
                    comment: null,
                    properties: [],
                });
            }
        } else if (objIRI.equals(OWL_DATATYPE_PROP) || objIRI.equals(OWL_OBJECT_PROP)) {
            if (!properties.has(subjectIRI)) {
                properties.set(subjectIRI, {
                    iri: subjectIRI,
                    name: localName(subjectIRI),
                    range: null,
                    comment: null,
                    kind: objIRI.equals(OWL_DATATYPE_PROP) ? "data" : "object",
                });
            }
        }
    }

    // Second pass: fill in labels, comments, domain/range
    for (const { subject, predicate, object } of triples) {
        if (!(subject instanceof IRI)) {
            continue;
        }
        const subjectIRI = subject.value;

        if (predicate.equals(RDFS_LABEL) || predicate.equals(RDFS_COMMENT)) {
            const value = literalValue(object);
            if (value === null) {
                continue;
            }

            const cls = classes.get(subjectIRI);
            if (cls && predicate.equals(RDFS_COMMENT)) {
                cls.comment = value;
            }

            const prop = properties.get(subjectIRI);
            if (prop && predicate.equals(RDFS_COMMENT)) {
                prop.comment = value;
            }
        }

        if (predicate.equals(RDFS_DOMAIN)) {
            const domainIRI = asIRI(object);
            if (!domainIRI) {
                continue;
            }
            const cls = classes.get(domainIRI.value);
            const prop = properties.get(subjectIRI);
            if (cls && prop && !cls.properties.find((p) => p.iri === prop.iri)) {
                cls.properties.push(prop);
            }
        }

        if (predicate.equals(RDFS_RANGE)) {
            const prop = properties.get(subjectIRI);
            const rangeIRI = asIRI(object);
            if (prop && rangeIRI) {
                prop.range = rangeIRI.value;
            }
        }
    }

    return { classes, properties };
}
