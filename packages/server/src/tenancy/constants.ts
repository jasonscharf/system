import { IRI } from "@jasonscharf/core";
import { NS_ROOT } from "@jasonscharf/core";

export const TENANCY_NS = `${NS_ROOT}tenancy:`;
export const TENANCY_GRAPH = new IRI(`${TENANCY_NS}graph`);

export const RDF_TYPE = new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
export const XSD_STRING = new IRI("http://www.w3.org/2001/XMLSchema#string");
export const XSD_DATETIME = new IRI("http://www.w3.org/2001/XMLSchema#dateTime");
export const XSD_ANY_URI = new IRI("http://www.w3.org/2001/XMLSchema#anyURI");
