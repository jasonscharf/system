import type { RdfObject, RdfSubject, Triple } from "@jasonscharf/core";
import { IRI } from "@jasonscharf/core";

const SH = "http://www.w3.org/ns/shacl#";

const RDF_TYPE = new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const SH_NODE_SHAPE = new IRI(`${SH}NodeShape`);
const SH_TARGET_CLASS = new IRI(`${SH}targetClass`);
const SH_PROPERTY = new IRI(`${SH}property`);
const SH_PATH = new IRI(`${SH}path`);
const SH_MIN_COUNT = new IRI(`${SH}minCount`);
const SH_MAX_COUNT = new IRI(`${SH}maxCount`);
const SH_DATATYPE = new IRI(`${SH}datatype`);
const SH_CLASS = new IRI(`${SH}class`);
const SH_PATTERN = new IRI(`${SH}pattern`);
const SH_MESSAGE = new IRI(`${SH}message`);
const SH_CLOSED = new IRI(`${SH}closed`);

export interface ShaclPropertyShape {
    path: string;
    minCount?: number;
    maxCount?: number;
    datatype?: string;
    classConstraint?: string;
    pattern?: string;
    message?: string;
}

export interface ShaclNodeShape {
    iri: string;
    targetClass: string;
    properties: ShaclPropertyShape[];
    closed?: boolean;
}

export interface ShaclShapes {
    nodeShapes: Map<string, ShaclNodeShape>;
    byTargetClass: Map<string, ShaclNodeShape>;
}

// A stable string key for any RDF term that can be a subject or object.
// IRI   → the IRI string
// Blank → "_:<id>"
// Literal → null (literals cannot be subjects of shapes)
function termKey(term: RdfSubject | RdfObject): string | null {
    if (term instanceof IRI) {
        return term.value;
    }
    if (term.termType === "BlankNode") {
        return `_:${term.id}`;
    }
    /* c8 ignore next -- Literal subjects are invalid in SHACL; unreachable in valid data */
    return null;
}

function literalStr(term: RdfObject): string | null {
    if (term instanceof IRI) {
        return null;
    }
    if (term.termType === "Literal") {
        return term.value;
    }
    /* c8 ignore next -- BlankNode where literal expected is invalid SHACL; unreachable in valid data */
    return null;
}

/**
 * Parses SHACL NodeShapes and their PropertyShapes from a flat list of triples.
 * Works with N-Triples output from parseNTriples — blank nodes are tracked by id.
 */
export function readShaclShapes(triples: Triple[]): ShaclShapes {
    const nodeShapes = new Map<string, ShaclNodeShape>();
    const propShapeMap = new Map<string, Partial<ShaclPropertyShape>>();
    // nodeShapeKey → list of property-shape keys (IRI or blank-node ids)
    const shapePropLinks = new Map<string, string[]>();

    // Pass 1: find NodeShapes (rdf:type sh:NodeShape)
    for (const { subject, predicate, object } of triples) {
        if (!predicate.equals(RDF_TYPE)) {
            continue;
        }
        if (!(object instanceof IRI) || !object.equals(SH_NODE_SHAPE)) {
            continue;
        }
        const key = termKey(subject);
        if (!key) {
            continue;
        }
        if (!nodeShapes.has(key)) {
            nodeShapes.set(key, { iri: key, targetClass: "", properties: [], closed: false });
        }
    }

    // Pass 2: fill NodeShape attributes; record sh:property blank-node links
    for (const { subject, predicate, object } of triples) {
        const subjKey = termKey(subject);
        if (!subjKey) {
            continue;
        }

        const shape = nodeShapes.get(subjKey);
        if (shape) {
            if (predicate.equals(SH_TARGET_CLASS)) {
                const objKey = termKey(object);
                if (objKey) {
                    shape.targetClass = objKey;
                }
            } else if (predicate.equals(SH_PROPERTY)) {
                const propKey = termKey(object);
                if (propKey) {
                    if (!shapePropLinks.has(subjKey)) {
                        shapePropLinks.set(subjKey, []);
                    }
                    shapePropLinks.get(subjKey)?.push(propKey);
                    if (!propShapeMap.has(propKey)) {
                        propShapeMap.set(propKey, {});
                    }
                }
            } else if (predicate.equals(SH_CLOSED)) {
                if (literalStr(object) === "true") {
                    shape.closed = true;
                }
            }
        }
    }

    // Pass 3: fill PropertyShape attributes
    for (const { subject, predicate, object } of triples) {
        const subjKey = termKey(subject);
        if (!subjKey || !propShapeMap.has(subjKey)) {
            continue;
        }
        const ps = propShapeMap.get(subjKey)!;

        if (predicate.equals(SH_PATH)) {
            const k = termKey(object);
            if (k) {
                ps.path = k;
            }
        } else if (predicate.equals(SH_MIN_COUNT)) {
            const v = literalStr(object);
            if (v !== null) {
                ps.minCount = parseInt(v, 10);
            }
        } else if (predicate.equals(SH_MAX_COUNT)) {
            const v = literalStr(object);
            if (v !== null) {
                ps.maxCount = parseInt(v, 10);
            }
        } else if (predicate.equals(SH_DATATYPE)) {
            const k = termKey(object);
            if (k) {
                ps.datatype = k;
            }
        } else if (predicate.equals(SH_CLASS)) {
            const k = termKey(object);
            if (k) {
                ps.classConstraint = k;
            }
        } else if (predicate.equals(SH_PATTERN)) {
            const v = literalStr(object);
            if (v !== null) {
                ps.pattern = v;
            }
        } else if (predicate.equals(SH_MESSAGE)) {
            const v = literalStr(object);
            if (v !== null) {
                ps.message = v;
            }
        }
    }

    // Link fully-resolved PropertyShapes onto their NodeShapes
    for (const [shapeKey, propKeys] of shapePropLinks) {
        const nodeShape = nodeShapes.get(shapeKey);
        if (!nodeShape) {
            continue;
        }
        for (const propKey of propKeys) {
            const ps = propShapeMap.get(propKey);
            if (ps?.path) {
                nodeShape.properties.push(ps as ShaclPropertyShape);
            }
        }
    }

    // Build byTargetClass index
    const byTargetClass = new Map<string, ShaclNodeShape>();
    for (const shape of nodeShapes.values()) {
        if (shape.targetClass) {
            byTargetClass.set(shape.targetClass, shape);
        }
    }

    return { nodeShapes, byTargetClass };
}

export function mergeShapes(a: ShaclShapes, b: ShaclShapes): ShaclShapes {
    const nodeShapes = new Map([...a.nodeShapes, ...b.nodeShapes]);
    const byTargetClass = new Map([...a.byTargetClass, ...b.byTargetClass]);
    return { nodeShapes, byTargetClass };
}
