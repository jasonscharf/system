import type { IRI } from "../semantics/IRI.js";
import type { BlankNode } from "./BlankNode.js";
import type { DefaultGraph } from "./DefaultGraph.js";
import type { Literal } from "./Literal.js";

export type RdfSubject = IRI | BlankNode;
export type RdfPredicate = IRI;
export type RdfObject = IRI | BlankNode | Literal;
export type RdfGraph = IRI | DefaultGraph;

export interface Triple {
    readonly subject: RdfSubject;
    readonly predicate: RdfPredicate;
    readonly object: RdfObject;
}

export interface Quad extends Triple {
    readonly graph: RdfGraph;
}

export function triple(subject: RdfSubject, predicate: RdfPredicate, object: RdfObject): Triple {
    return { subject, predicate, object };
}

export function quad(
    subject: RdfSubject,
    predicate: RdfPredicate,
    object: RdfObject,
    graph: RdfGraph,
): Quad {
    return { subject, predicate, object, graph };
}
