import { createHash } from "node:crypto";
import type { IRI, Quad } from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { EntityRecord, EntitySchema, PropertyDef } from "@jasonscharf/entities";
import { fromLiteral, propIri, toLiteral } from "@jasonscharf/entities";
import type { ServerContext } from "./ServerContext.js";

// ── Registry named graph ──────────────────────────────────────────────────────

const REGISTRY_GRAPH = { value: "urn:sys:graph:schema-registry" } as IRI;

// ── Schema record predicates ──────────────────────────────────────────────────

const P_TYPE_IRI   = { value: "urn:sys:schema:typeIri" } as IRI;
const P_VERSION    = { value: "urn:sys:schema:version" } as IRI;
const P_REGISTERED = { value: "urn:sys:schema:registeredAt" } as IRI;
const P_HAS_PROP   = { value: "urn:sys:schema:hasProperty" } as IRI;
const P_HAS_EDGE   = { value: "urn:sys:schema:hasEdge" } as IRI;

// ── Property descriptor predicates ───────────────────────────────────────────

const P_PROP_NAME  = { value: "urn:sys:schema:propName" } as IRI;
const P_PROP_PRED  = { value: "urn:sys:schema:propPredicateIri" } as IRI;
const P_PROP_RANGE = { value: "urn:sys:schema:propRangeIri" } as IRI;

// ── Edge descriptor predicates ────────────────────────────────────────────────

const P_EDGE_NAME   = { value: "urn:sys:schema:edgeName" } as IRI;
const P_EDGE_PRED   = { value: "urn:sys:schema:edgePredicateIri" } as IRI;
const P_EDGE_TARGET = { value: "urn:sys:schema:edgeTargetType" } as IRI;
const P_EDGE_CARD   = { value: "urn:sys:schema:edgeCardinality" } as IRI;
const P_EDGE_DIR    = { value: "urn:sys:schema:edgeDirection" } as IRI;

/** Predicate used to stamp the schema version string onto each entity node. */
export const SCHEMA_VERSION_PREDICATE: IRI = { value: "urn:sys:schema:entityVersion" } as IRI;

// ── Public types ──────────────────────────────────────────────────────────────

export interface TypeVersion {
    version: string;
    typeIri: string;
    registeredAt: Date;
}

export interface PropertyDescriptor {
    name: string;
    predicateIri: string;
    rangeIri?: string;
}

export interface EdgeDescriptor {
    name: string;
    predicateIri: string;
    targetTypeIri: string;
    cardinality: "one" | "many";
    direction: "out" | "in";
}

export interface TypeSnapshot {
    version: string;
    typeIri: string;
    properties: PropertyDescriptor[];
    edges: EdgeDescriptor[];
}

export interface TraversalStep {
    edgeName: string;
    targetSchema: EntitySchema;
    cardinality: "one" | "many";
    depth: number;
}

export interface TraversalPlan {
    root: EntitySchema;
    steps: TraversalStep[];
}

export type HydratedRecord<Props extends Record<string, unknown> = Record<string, unknown>> =
    EntityRecord<Props> & { related: Record<string, EntityRecord | null> };

// ── Hash computation ──────────────────────────────────────────────────────────

function computeHash8(schema: EntitySchema): string {
    const parts: string[] = [schema.typeIRI.value];

    const propParts: string[] = [];
    for (const p of Object.values(schema.properties as Record<string, IRI | PropertyDef>)) {
        const pred = propIri(p);
        const range = "iri" in p ? (p as PropertyDef).range?.value : undefined;
        propParts.push(range ? `${pred.value}:${range}` : pred.value);
    }
    propParts.sort();
    parts.push(...propParts);

    const edgeParts: string[] = [];
    for (const def of Object.values(schema.edges ?? {})) {
        const target = def.target?.()?.typeIRI.value ?? "";
        const card = def.cardinality ?? "one";
        const dir = def.direction ?? "out";
        edgeParts.push(`${def.predicate.value}:${target}:${card}:${dir}`);
    }
    edgeParts.sort();
    parts.push(...edgeParts);

    return createHash("sha256").update(parts.join("\x00")).digest("hex").slice(0, 8);
}

// ── SchemaRegistry ────────────────────────────────────────────────────────────

export class SchemaRegistry {
    private readonly _cache = new WeakMap<EntitySchema, string>();

    constructor(private readonly _store: TripleStore) {}

    // ── Synchronous version access ────────────────────────────────────────────

    /**
     * Returns the current version string for a schema.  Returns a provisional
     * "0-{hash8}" before ensureVersion() is called; the real "{n}-{hash8}" after.
     * The hash portion is stable and deterministic from the schema shape.
     */
    currentVersion(schema: EntitySchema): string {
        const cached = this._cache.get(schema);
        if (cached) {
            return cached;
        }
        const provisional = `0-${computeHash8(schema)}`;
        this._cache.set(schema, provisional);
        return provisional;
    }

    // ── Version registration ──────────────────────────────────────────────────

    /**
     * Idempotently registers a schema version in the store.  If the schema hash
     * already exists for the type, the existing version record is returned.
     * Otherwise a new record is created with the next monotonic version number
     * scoped to the type IRI.
     */
    async ensureVersion(ctx: ServerContext, schema: EntitySchema): Promise<TypeVersion> {
        const hash8 = computeHash8(schema);
        const typeIri = schema.typeIRI.value;

        const existing = await this._loadVersionsForType(ctx, typeIri);

        const matched = existing.find((v) => v.version.endsWith(`-${hash8}`));
        if (matched) {
            this._cache.set(schema, matched.version);
            return matched;
        }

        const n = existing.length + 1;
        const versionStr = `${n}-${hash8}`;
        const versionNode = _versionNode(versionStr);
        const now = new Date();

        type InsertQuad = Parameters<TripleStore["insertMany"]>[1][number];
        const quads: InsertQuad[] = [
            { subject: versionNode, predicate: P_TYPE_IRI,   object: toLiteral(typeIri),   graph: REGISTRY_GRAPH },
            { subject: versionNode, predicate: P_VERSION,    object: toLiteral(versionStr), graph: REGISTRY_GRAPH },
            { subject: versionNode, predicate: P_REGISTERED, object: toLiteral(now),        graph: REGISTRY_GRAPH },
        ];

        let propIdx = 0;
        for (const [name, p] of Object.entries(schema.properties as Record<string, IRI | PropertyDef>)) {
            const pred = propIri(p);
            const range = "iri" in p ? (p as PropertyDef).range : undefined;
            const propNode = { value: `${versionNode.value}:prop:${propIdx++}` } as IRI;
            quads.push(
                { subject: versionNode, predicate: P_HAS_PROP,  object: propNode,             graph: REGISTRY_GRAPH },
                { subject: propNode,    predicate: P_PROP_NAME, object: toLiteral(name),       graph: REGISTRY_GRAPH },
                { subject: propNode,    predicate: P_PROP_PRED, object: toLiteral(pred.value), graph: REGISTRY_GRAPH },
            );
            if (range) {
                quads.push({ subject: propNode, predicate: P_PROP_RANGE, object: toLiteral(range.value), graph: REGISTRY_GRAPH });
            }
        }

        let edgeIdx = 0;
        for (const [name, def] of Object.entries(schema.edges ?? {})) {
            const target = def.target?.()?.typeIRI.value ?? "";
            const card = def.cardinality ?? "one";
            const dir = def.direction ?? "out";
            const edgeNode = { value: `${versionNode.value}:edge:${edgeIdx++}` } as IRI;
            quads.push(
                { subject: versionNode, predicate: P_HAS_EDGE,    object: edgeNode,                     graph: REGISTRY_GRAPH },
                { subject: edgeNode,    predicate: P_EDGE_NAME,   object: toLiteral(name),              graph: REGISTRY_GRAPH },
                { subject: edgeNode,    predicate: P_EDGE_PRED,   object: toLiteral(def.predicate.value), graph: REGISTRY_GRAPH },
                { subject: edgeNode,    predicate: P_EDGE_TARGET, object: toLiteral(target),            graph: REGISTRY_GRAPH },
                { subject: edgeNode,    predicate: P_EDGE_CARD,   object: toLiteral(card),              graph: REGISTRY_GRAPH },
                { subject: edgeNode,    predicate: P_EDGE_DIR,    object: toLiteral(dir),               graph: REGISTRY_GRAPH },
            );
        }

        await this._store.insertMany(ctx, quads);
        this._cache.set(schema, versionStr);
        return { version: versionStr, typeIri, registeredAt: now };
    }

    // ── Read ──────────────────────────────────────────────────────────────────

    /** Returns the TypeVersion record for a given version string, or null. */
    async loadVersion(ctx: ServerContext, versionString: string): Promise<TypeVersion | null> {
        const vNode = _versionNode(versionString);
        const quads = await this._store.find(ctx, { subject: vNode, graph: REGISTRY_GRAPH });
        if (quads.length === 0) {
            return null;
        }
        return _extractTypeVersion(quads);
    }

    /** Returns the snapshot for the latest registered version of a type, or null. */
    async loadSnapshot(ctx: ServerContext, typeIri: string): Promise<TypeSnapshot | null> {
        const existing = await this._loadVersionsForType(ctx, typeIri);
        if (existing.length === 0) {
            return null;
        }
        const best = existing.reduce((a, b) =>
            _versionNumber(a.version) >= _versionNumber(b.version) ? a : b,
        );
        return this._loadSnapshotForNodeIri(ctx, _versionNode(best.version).value);
    }

    /** Returns the snapshot for a specific version string, or null. */
    async loadSnapshotForVersion(ctx: ServerContext, versionString: string): Promise<TypeSnapshot | null> {
        const vNode = _versionNode(versionString);
        const quads = await this._store.find(ctx, { subject: vNode, graph: REGISTRY_GRAPH });
        if (quads.length === 0) {
            return null;
        }
        return this._loadSnapshotForNodeIri(ctx, vNode.value);
    }

    // ── Traversal planning ────────────────────────────────────────────────────

    /**
     * Synchronously builds a traversal plan describing all out-edge hops reachable
     * from `schema` within `depth` hops.  Pure — no DB access.
     */
    traversalPlan(schema: EntitySchema, depth: number): TraversalPlan {
        const steps: TraversalStep[] = [];
        if (depth > 0) {
            const queue: Array<{ s: EntitySchema; d: number }> = [{ s: schema, d: 0 }];
            while (queue.length > 0) {
                const item = queue.shift()!;
                if (item.d >= depth) {
                    continue;
                }
                for (const [edgeName, def] of Object.entries(item.s.edges ?? {})) {
                    if ((def.direction ?? "out") !== "out" || !def.target) {
                        continue;
                    }
                    const targetSchema = def.target();
                    steps.push({
                        edgeName,
                        targetSchema,
                        cardinality: def.cardinality ?? "one",
                        depth: item.d + 1,
                    });
                    queue.push({ s: targetSchema, d: item.d + 1 });
                }
            }
        }
        return { root: schema, steps };
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private async _loadVersionsForType(
        ctx: ServerContext,
        typeIri: string,
    ): Promise<TypeVersion[]> {
        const quads = await this._store.find(ctx, {
            predicate: P_TYPE_IRI,
            object: toLiteral(typeIri),
            graph: REGISTRY_GRAPH,
        });

        const versions: TypeVersion[] = [];
        for (const q of quads) {
            const nodeIri = (q.subject as IRI).value;
            const nodeQuads = await this._store.find(ctx, {
                subject: { value: nodeIri } as IRI,
                graph: REGISTRY_GRAPH,
            });
            const tv = _extractTypeVersion(nodeQuads);
            if (tv) {
                versions.push(tv);
            }
        }
        return versions;
    }

    private async _loadSnapshotForNodeIri(
        ctx: ServerContext,
        nodeIri: string,
    ): Promise<TypeSnapshot | null> {
        const vNode = { value: nodeIri } as IRI;
        const nodeQuads = await this._store.find(ctx, { subject: vNode, graph: REGISTRY_GRAPH });

        let typeIri = "";
        let version = "";
        const propNodeIris: string[] = [];
        const edgeNodeIris: string[] = [];

        for (const q of nodeQuads) {
            const pred = (q.predicate as IRI).value;
            if (pred === P_TYPE_IRI.value) {
                typeIri = String(fromLiteral(q.object));
            } else if (pred === P_VERSION.value) {
                version = String(fromLiteral(q.object));
            } else if (pred === P_HAS_PROP.value) {
                const iri = _objectIriValue(q.object);
                if (iri) {
                    propNodeIris.push(iri);
                }
            } else if (pred === P_HAS_EDGE.value) {
                const iri = _objectIriValue(q.object);
                if (iri) {
                    edgeNodeIris.push(iri);
                }
            }
        }

        if (!typeIri || !version) {
            return null;
        }

        const properties: PropertyDescriptor[] = [];
        for (const pNodeIri of propNodeIris) {
            const pQuads = await this._store.find(ctx, {
                subject: { value: pNodeIri } as IRI,
                graph: REGISTRY_GRAPH,
            });
            let name = "";
            let predicateIri = "";
            let rangeIri: string | undefined;
            for (const q of pQuads) {
                const pred = (q.predicate as IRI).value;
                if (pred === P_PROP_NAME.value) {
                    name = String(fromLiteral(q.object));
                } else if (pred === P_PROP_PRED.value) {
                    predicateIri = String(fromLiteral(q.object));
                } else if (pred === P_PROP_RANGE.value) {
                    rangeIri = String(fromLiteral(q.object));
                }
            }
            if (name && predicateIri) {
                properties.push({ name, predicateIri, rangeIri });
            }
        }

        const edges: EdgeDescriptor[] = [];
        for (const eNodeIri of edgeNodeIris) {
            const eQuads = await this._store.find(ctx, {
                subject: { value: eNodeIri } as IRI,
                graph: REGISTRY_GRAPH,
            });
            let name = "";
            let predicateIri = "";
            let targetTypeIri = "";
            let cardinality: "one" | "many" = "one";
            let direction: "out" | "in" = "out";
            for (const q of eQuads) {
                const pred = (q.predicate as IRI).value;
                if (pred === P_EDGE_NAME.value) {
                    name = String(fromLiteral(q.object));
                } else if (pred === P_EDGE_PRED.value) {
                    predicateIri = String(fromLiteral(q.object));
                } else if (pred === P_EDGE_TARGET.value) {
                    targetTypeIri = String(fromLiteral(q.object));
                } else if (pred === P_EDGE_CARD.value) {
                    cardinality = String(fromLiteral(q.object)) as "one" | "many";
                } else if (pred === P_EDGE_DIR.value) {
                    direction = String(fromLiteral(q.object)) as "out" | "in";
                }
            }
            if (name) {
                edges.push({ name, predicateIri, targetTypeIri, cardinality, direction });
            }
        }

        return { version, typeIri, properties, edges };
    }
}

// ── Module helpers ────────────────────────────────────────────────────────────

function _versionNode(versionStr: string): IRI {
    return { value: `urn:sys:schema:v:${encodeURIComponent(versionStr)}` } as IRI;
}

function _versionNumber(v: string): number {
    return parseInt(v.split("-")[0]!, 10);
}

function _extractTypeVersion(quads: Quad[]): TypeVersion | null {
    let typeIri = "";
    let version = "";
    let registeredAt = new Date(0);
    for (const q of quads) {
        const pred = (q.predicate as IRI).value;
        if (pred === P_TYPE_IRI.value) {
            typeIri = String(fromLiteral(q.object));
        } else if (pred === P_VERSION.value) {
            version = String(fromLiteral(q.object));
        } else if (pred === P_REGISTERED.value) {
            const val = fromLiteral(q.object);
            if (val instanceof Date) {
                registeredAt = val;
            }
        }
    }
    if (!typeIri || !version) {
        return null;
    }
    return { version, typeIri, registeredAt };
}

function _objectIriValue(obj: unknown): string | null {
    if (obj && typeof obj === "object" && !("termType" in obj) && "value" in obj) {
        return (obj as IRI).value;
    }
    return null;
}
