import { IRI, makeUri, NS_CORE } from "@jasonscharf/core";

export const SUPERUSER_NS = makeUri(NS_CORE, "superuser");
export const SUPERUSER_GRAPH = new IRI(makeUri(SUPERUSER_NS, "graph"));

// Singleton IRI used as the subject node for the superuser membership set.
export const SUPERUSERS_NODE = new IRI(makeUri(SUPERUSER_NS, "members"));

export const RDF_TYPE = new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
export const XSD_ANY_URI = new IRI("http://www.w3.org/2001/XMLSchema#anyURI");
export const XSD_DATETIME = new IRI("http://www.w3.org/2001/XMLSchema#dateTime");

// Type IRI for the superuser membership set
export const SuperuserIRI = new IRI(makeUri(SUPERUSER_NS, "Superuser"));

// Predicate IRIs
export const superuserUserIRI = new IRI(makeUri(SUPERUSER_NS, "user"));
export const superuserGrantedAtIRI = new IRI(makeUri(SUPERUSER_NS, "grantedAt"));
