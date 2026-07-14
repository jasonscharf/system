import { DEFAULT_GRAPH, type DefaultGraph, type IRI, type Quad } from "@jasonscharf/core";
import type { EntityTimestamps, TripleStore } from "@jasonscharf/data";
import type {
    EdgeDef,
    EdgeHandle,
    EdgeRef,
    EdgeSet,
    EntityRecord,
    EntitySchema,
    IFieldCipher,
    PropertyDef,
} from "@jasonscharf/entities";
import {
    EntityValidationError,
    entityIriFor,
    fromLiteral,
    idFromIri,
    invertPropertyMap,
    propertyMapFor,
    propIri,
    RDF_TYPE,
    toEncryptedLiteral,
    toLiteral,
} from "@jasonscharf/entities";
import { validate } from "@jasonscharf/gen";
import type { CollectionViewOpts } from "./CollectionView.js";
import { CollectionViewStore } from "./CollectionView.js";
import {
    type HydratedRecord,
    SCHEMA_VERSION_PREDICATE,
    type SchemaRegistry,
    type TraversalPlan,
} from "./SchemaRegistry.js";
import { buildServerContext, type ServerContext } from "./ServerContext.js";
import { tenantGraph, tenantGraphForInsert } from "./tenancy.js";

// ── EntityStore ───────────────────────────────────────────────────────────────

export class EntityStore {
    private _cvsInstance: CollectionViewStore | null = null;

    constructor(
        private readonly _store: TripleStore,
        private readonly _registry?: SchemaRegistry,
        private readonly _cipher?: IFieldCipher,
    ) {}

    /** The underlying TripleStore — for raw quad access or EntityQuery builder. */
    get store(): TripleStore {
        return this._store;
    }

    /**
     * Resolves the field cipher for the current operation: the context cipher
     * wins (request-scoped wiring), else the one bound at construction.  Returns
     * null when neither is set.
     */
    private _cipherFor(ctx: ServerContext): IFieldCipher | null {
        return ctx.cipher ?? this._cipher ?? null;
    }

    /** True when a property is PII (must be encrypted at rest). */
    private _isPii(prop: IRI | PropertyDef): boolean {
        return typeof prop === "object" && "pii" in prop && prop.pii === true;
    }

    /**
     * Turns a property value into a quad object literal, encrypting it when the
     * property is PII.  Encryption is mandatory for PII: with no cipher available
     * this throws rather than persisting cleartext — encryption is the default at
     * rest, never silently skipped.
     */
    private _propObject(
        ctx: ServerContext,
        prop: IRI | PropertyDef,
        value: unknown,
    ): ReturnType<typeof toLiteral> {
        if (!this._isPii(prop)) {
            return toLiteral(value);
        }
        const cipher = this._cipherFor(ctx);
        if (!cipher) {
            throw new Error(
                `EntityStore: property ${propIri(prop).value} is PII but no field cipher is ` +
                    "available on the context or store; cannot persist PII as cleartext.",
            );
        }
        return toEncryptedLiteral(value, cipher);
    }

    /**
     * Decrypts a PII property value loaded from the store.  The stored literal
     * holds ciphertext; this returns the plaintext.  Non-PII values pass through
     * untouched.
     *
     * Decryption uses the cipher's current key id.  TripleStore.find() projects a
     * Quad and does not surface the node's `key_id` column, so a value encrypted
     * under a rotated-out key cannot be addressed by id here yet.  That is fine
     * for this seam (single active key); full lazy rotation will surface the node
     * key id on read.  The cipher stays deterministic so that work is possible.
     */
    private _decryptValue(ctx: ServerContext, prop: IRI | PropertyDef, value: unknown): unknown {
        if (!this._isPii(prop) || typeof value !== "string") {
            return value;
        }
        const cipher = this._cipherFor(ctx);
        if (!cipher) {
            throw new Error(
                `EntityStore: property ${propIri(prop).value} is PII but no field cipher is ` +
                    "available on the context or store; cannot decrypt stored ciphertext.",
            );
        }
        return cipher.decrypt(cipher.currentKeyId, value);
    }

    // ── Transaction helpers ───────────────────────────────────────────────────

    async inTransaction<T>(
        ctxOrFn: ServerContext | ((ctx: ServerContext) => Promise<T>),
        maybeFn?: (ctx: ServerContext) => Promise<T>,
    ): Promise<T> {
        if (typeof ctxOrFn === "function") {
            return this._store.knex.transaction(async (trx) =>
                ctxOrFn(buildServerContext(this._store, { trx })),
            );
        }
        if (!maybeFn) {
            throw new Error("inTransaction(ctx, fn): fn is required when ctx is provided");
        }
        return this._store.knex.transaction(async (trx) => maybeFn({ ...ctxOrFn, trx }));
    }

    private async _withTrx<T>(
        ctx: ServerContext,
        fn: (ctx: ServerContext) => Promise<T>,
    ): Promise<T> {
        return this._store.withTransaction(ctx, fn);
    }

    /** Graph for read/delete filters: a fixed graphIri wins, else tenant scoping. */
    private _filterGraph(ctx: ServerContext, schema: EntitySchema): IRI | null {
        return schema.graphIri ?? tenantGraph(ctx, schema.graph);
    }

    /** Graph for inserts: a fixed graphIri wins, else tenant scoping (DEFAULT_GRAPH fallback). */
    private _insertGraph(ctx: ServerContext, schema: EntitySchema): IRI | DefaultGraph {
        return schema.graphIri ?? tenantGraphForInsert(ctx, schema.graph);
    }

    // ── Create ────────────────────────────────────────────────────────────────

    async create<Props extends Record<string, unknown>>(
        ctx: ServerContext,
        schema: EntitySchema<Props>,
        data: EntityInput<Props>,
        id: string = _newId(),
    ): Promise<EntityRecord<Props>> {
        const withDefs = this._applyDefaults(schema, data);
        this._validate(schema, withDefs);

        const ent = entityIriFor(schema, id);
        const edgeTargets = resolveEdgeTargets(schema, data);

        return this._withTrx(ctx, async (txCtx) => {
            if (this._registry) {
                await this._registry.ensureVersion(txCtx, schema);
            }
            const schemaVersion = this._registry?.currentVersion(schema);
            const graph = this._insertGraph(txCtx, schema);
            type InsertQuad = Parameters<TripleStore["insertMany"]>[1][number];
            const quads: InsertQuad[] = [
                { subject: ent, predicate: RDF_TYPE, object: schema.typeIRI, graph },
                ...this._propQuads(txCtx, ent, schema, withDefs, graph),
                ...edgeQuads(ent, edgeTargets, graph),
            ];
            if (schemaVersion) {
                quads.push({
                    subject: ent,
                    predicate: SCHEMA_VERSION_PREDICATE,
                    object: toLiteral(schemaVersion),
                    graph,
                });
            }
            await this._store.insertMany(txCtx, quads);
            const record: EntityRecord<Props> = {
                id,
                iri: ent.value,
                props: pickProps(schema, withDefs) as Props,
                schemaVersion,
            };
            const edges = this._buildEdgeHandles(schema, edgeTargetMap(schema, edgeTargets));
            if (edges) {
                record.edges = edges;
            }
            const ts = (
                await this._store.entityTimestamps(txCtx, [ent], this._filterGraph(txCtx, schema))
            ).get(ent.value);
            if (ts) {
                record.createdAt = ts.createdAt;
                record.updatedAt = ts.updatedAt;
            }
            return record;
        });
    }

    // ── Read ──────────────────────────────────────────────────────────────────

    async findById<Props extends Record<string, unknown>>(
        ctx: ServerContext,
        schema: EntitySchema<Props>,
        id: string,
    ): Promise<EntityRecord<Props> | null> {
        return this._withTrx(ctx, async (txCtx) => {
            const ent = entityIriFor(schema, id);
            const graph = this._filterGraph(txCtx, schema);
            const typeQ = await this._store.find(txCtx, {
                subject: ent,
                predicate: RDF_TYPE,
                graph,
            });
            if (typeQ.length === 0) {
                return null;
            }
            return this._hydrate(txCtx, schema, id, ent.value, graph);
        });
    }

    // ── Update ────────────────────────────────────────────────────────────────

    async update<Props extends Record<string, unknown>>(
        ctx: ServerContext,
        schema: EntitySchema<Props>,
        id: string,
        patch: EntityInput<Props>,
    ): Promise<void> {
        this._validate(schema, patch);

        const ent = entityIriFor(schema, id);
        const props = schema.properties as Record<string, IRI | PropertyDef>;
        const patchEntries = Object.entries(patch).filter(([propName]) => !!props[propName]);
        const edgeTargets = resolveEdgeTargets(schema, patch);
        const predIris = [
            ...patchEntries.map(([propName]) => {
                const p = props[propName];
                if (p == null) {
                    throw new Error(`EntityStore.update: missing IRI for property "${propName}"`);
                }
                return propIri(p);
            }),
            ...edgeTargets.map((e) => e.predicate),
        ];

        return this._withTrx(ctx, async (txCtx) => {
            const filterGraph = this._filterGraph(txCtx, schema);
            const insertGraph = this._insertGraph(txCtx, schema);
            if (predIris.length > 0) {
                await this._store.deleteBySubjectPredicates(txCtx, ent, predIris, filterGraph);
            }
            const quads = [
                ...patchEntries
                    .filter(([, value]) => value !== undefined)
                    .map(([propName, value]) => {
                        const p = props[propName];
                        if (p == null) {
                            throw new Error(
                                `EntityStore.update: missing IRI for property "${propName}"`,
                            );
                        }
                        return {
                            subject: ent,
                            predicate: propIri(p),
                            object: this._propObject(txCtx, p, value),
                            graph: insertGraph,
                        };
                    }),
                ...edgeQuads(ent, edgeTargets, insertGraph),
            ];
            if (quads.length > 0) {
                await this._store.insertMany(txCtx, quads);
            }
        });
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    async delete(ctx: ServerContext, schema: EntitySchema, id: string): Promise<void> {
        const ent = entityIriFor(schema, id);
        return this._withTrx(ctx, async (txCtx) => {
            await this._store.delete(txCtx, {
                subject: ent,
                graph: this._filterGraph(txCtx, schema),
            });
        });
    }

    // ── Edge mutation ─────────────────────────────────────────────────────────

    /**
     * Append a single edge (entity --edgeName--> target) without disturbing the
     * entity's other edges.  Idempotent.  Use for many-edges like group
     * membership or role inheritance, where update() would replace the whole set.
     */
    async addEdge(
        ctx: ServerContext,
        schema: EntitySchema,
        id: string,
        edgeName: string,
        target: EdgeInput,
    ): Promise<void> {
        const def = schema.edges?.[edgeName];
        if (!def) {
            throw new Error(`EntityStore.addEdge: schema has no edge "${edgeName}"`);
        }
        const ent = entityIriFor(schema, id);
        const targetIri = edgeTargetIri(target, def.target?.());
        return this._withTrx(ctx, async (txCtx) => {
            await this._store.insert(txCtx, {
                subject: ent,
                predicate: def.predicate,
                object: { value: targetIri } as IRI,
                graph: this._insertGraph(txCtx, schema),
            });
        });
    }

    /** Soft-delete a single edge (entity --edgeName--> target). */
    async removeEdge(
        ctx: ServerContext,
        schema: EntitySchema,
        id: string,
        edgeName: string,
        target: EdgeInput,
    ): Promise<boolean> {
        const def = schema.edges?.[edgeName];
        if (!def) {
            throw new Error(`EntityStore.removeEdge: schema has no edge "${edgeName}"`);
        }
        const ent = entityIriFor(schema, id);
        const targetIri = edgeTargetIri(target, def.target?.());
        return this._withTrx(ctx, async (txCtx) => {
            const n = await this._store.delete(txCtx, {
                subject: ent,
                predicate: def.predicate,
                object: { value: targetIri } as IRI,
                graph: this._filterGraph(txCtx, schema),
            });
            return n > 0;
        });
    }

    /**
     * Insert a single edge whose target is an arbitrary IRI not described by a
     * schema edge — an ownership-backbone link (e.g. tenant --hasWorkflow-->
     * workflow) whose ends are not both modelled as EntitySchema edges.  Mirrors
     * addEdge but takes the predicate and target IRI directly, so callers stop
     * hand-building quads against the raw TripleStore.  Idempotent; runs in a
     * chainable transaction.  The graph defaults to the caller's insert graph
     * (tenant-scoped, DEFAULT_GRAPH fallback).
     */
    async addRawEdge(
        ctx: ServerContext,
        fromIri: string,
        predicate: IRI,
        toIri: string,
        graph?: IRI | DefaultGraph,
    ): Promise<void> {
        return this._withTrx(ctx, async (txCtx) => {
            await this._store.insert(txCtx, {
                subject: { value: fromIri } as IRI,
                predicate,
                object: { value: toIri } as IRI,
                graph: graph ?? tenantGraphForInsert(txCtx, undefined),
            });
        });
    }

    /** Soft-delete a single raw edge (fromIri --predicate--> toIri). */
    async removeRawEdge(
        ctx: ServerContext,
        fromIri: string,
        predicate: IRI,
        toIri: string,
        graph?: IRI | null,
    ): Promise<boolean> {
        return this._withTrx(ctx, async (txCtx) => {
            const n = await this._store.delete(txCtx, {
                subject: { value: fromIri } as IRI,
                predicate,
                object: { value: toIri } as IRI,
                graph: graph ?? tenantGraph(txCtx),
            });
            return n > 0;
        });
    }

    // ── Collection API ────────────────────────────────────────────────────────

    async collectionGet(
        ctx: ServerContext,
        schema: EntitySchema,
        id: string,
        prop: string,
    ): Promise<unknown[]> {
        return this._withTrx(ctx, async (txCtx) => {
            const propDef = (schema.properties as Record<string, IRI | PropertyDef>)[prop];
            if (!propDef) {
                return [];
            }
            const ent = entityIriFor(schema, id);
            const quads = await this._store.findOrdered(txCtx, {
                subject: ent,
                predicate: propIri(propDef),
                graph: this._filterGraph(txCtx, schema),
            });
            return quads
                .map((q) => this._decryptValue(txCtx, propDef, fromLiteral(q.object)))
                .filter((v) => v !== undefined);
        });
    }

    async collectionPush(
        ctx: ServerContext,
        schema: EntitySchema,
        id: string,
        prop: string,
        ...values: unknown[]
    ): Promise<void> {
        const propDef = (schema.properties as Record<string, IRI | PropertyDef>)[prop];
        if (!propDef) {
            throw new Error(`Property '${prop}' not found in schema`);
        }
        const predIri = propIri(propDef);
        const ent = entityIriFor(schema, id);

        return this._withTrx(ctx, async (txCtx) => {
            const graph = this._insertGraph(txCtx, schema);
            const viewIris = await this._cvs().findViewsForSource(txCtx, ent.value, predIri.value);

            await this._store.insertMany(
                txCtx,
                values.map((v) => ({
                    subject: ent,
                    predicate: predIri,
                    object: this._propObject(txCtx, propDef, v),
                    graph,
                })),
            );
            for (const v of values) {
                for (const vIri of viewIris) {
                    await this._cvs().addItem(txCtx, vIri, String(v));
                }
            }
        });
    }

    async collectionRemove(
        ctx: ServerContext,
        schema: EntitySchema,
        id: string,
        prop: string,
        value: unknown,
    ): Promise<boolean> {
        const propDef = (schema.properties as Record<string, IRI | PropertyDef>)[prop];
        if (!propDef) {
            return false;
        }
        const predIri = propIri(propDef);
        const ent = entityIriFor(schema, id);

        let deleted = false;
        await this._withTrx(ctx, async (txCtx) => {
            const count = await this._store.delete(txCtx, {
                subject: ent,
                predicate: predIri,
                object: this._propObject(txCtx, propDef, value),
                graph: this._filterGraph(txCtx, schema),
            });
            deleted = count > 0;
            if (deleted) {
                const viewIris = await this._cvs().findViewsForSource(
                    txCtx,
                    ent.value,
                    predIri.value,
                );
                for (const vIri of viewIris) {
                    await this._cvs().removeItem(txCtx, vIri, String(value));
                }
            }
        });
        return deleted;
    }

    async collectionPop(
        ctx: ServerContext,
        schema: EntitySchema,
        id: string,
        prop: string,
    ): Promise<unknown> {
        return this._withTrx(ctx, async (txCtx) => {
            const items = await this.collectionGet(txCtx, schema, id, prop);
            if (items.length === 0) {
                return undefined;
            }
            const last = items[items.length - 1];
            await this.collectionRemove(txCtx, schema, id, prop, last);
            return last;
        });
    }

    async collectionSet(
        ctx: ServerContext,
        schema: EntitySchema,
        id: string,
        prop: string,
        values: unknown[],
    ): Promise<void> {
        const propDef = (schema.properties as Record<string, IRI | PropertyDef>)[prop];
        if (!propDef) {
            throw new Error(`Property '${prop}' not found in schema`);
        }
        const predIri = propIri(propDef);
        const ent = entityIriFor(schema, id);

        return this._withTrx(ctx, async (txCtx) => {
            const filterGraph = this._filterGraph(txCtx, schema);
            const insertGraph = this._insertGraph(txCtx, schema);
            await this._store.delete(txCtx, {
                subject: ent,
                predicate: predIri,
                graph: filterGraph,
            });
            if (values.length > 0) {
                await this._store.insertMany(
                    txCtx,
                    values.map((v) => ({
                        subject: ent,
                        predicate: predIri,
                        object: this._propObject(txCtx, propDef, v),
                        graph: insertGraph,
                    })),
                );
            }
            const viewIris = await this._cvs().findViewsForSource(txCtx, ent.value, predIri.value);
            for (const vIri of viewIris) {
                await this._cvs().sync(txCtx, vIri, values.map(String));
            }
        });
    }

    async collectionInsertAt(
        ctx: ServerContext,
        schema: EntitySchema,
        id: string,
        prop: string,
        index: number,
        value: unknown,
    ): Promise<void> {
        return this._withTrx(ctx, async (txCtx) => {
            const current = await this.collectionGet(txCtx, schema, id, prop);
            const clamped = Math.max(0, Math.min(index, current.length));
            current.splice(clamped, 0, value);
            await this.collectionSet(txCtx, schema, id, prop, current);
        });
    }

    // ── CollectionView convenience ────────────────────────────────────────────

    async createCollectionView(
        ctx: ServerContext,
        schema: EntitySchema,
        id: string,
        prop: string,
        opts: CollectionViewOpts = {},
    ): Promise<string> {
        const propDef = (schema.properties as Record<string, IRI | PropertyDef>)[prop];
        if (!propDef) {
            throw new Error(`Property '${prop}' not found in schema`);
        }
        const predIri = propIri(propDef);
        const ent = entityIriFor(schema, id);

        return this._withTrx(ctx, async (txCtx) => {
            const currentRefs = (await this.collectionGet(txCtx, schema, id, prop)).map(String);
            return this._cvs().create(txCtx, ent.value, predIri.value, currentRefs, opts);
        });
    }

    get views(): CollectionViewStore {
        return this._cvs();
    }

    // ── Batch helpers used by EntityQuery ─────────────────────────────────────

    async hydrateMany<Props extends Record<string, unknown>>(
        ctx: ServerContext,
        schema: EntitySchema<Props>,
        iris: string[],
    ): Promise<EntityRecord<Props>[]> {
        return this._withTrx(ctx, async (txCtx) => {
            const graph = this._filterGraph(txCtx, schema);
            // Single round-trip for all subjects — no per-IRI N+1.
            const subjects = iris.map((iri) => ({ value: iri }) as IRI);
            const bySubject = await this._store.findForSubjects(txCtx, subjects, graph);
            const tsBySubject = await this._store.entityTimestamps(txCtx, subjects, graph);
            // Drop subjects that carry no rdf:type quad for this schema in the
            // scoped graph. A foreign-tenant subject may share an IRI but has no
            // type triple here; without this it would surface as an empty ghost
            // record (an existence + IRI/id leak across the tenant boundary).
            return iris
                .filter((iri) => hasTypeQuad(bySubject.get(iri), schema.typeIRI))
                .map((iri) =>
                    this._recordFromQuads(
                        txCtx,
                        schema,
                        idFromIri(iri),
                        iri,
                        bySubject.get(iri) ?? [],
                        tsBySubject.get(iri),
                    ),
                );
        });
    }

    /**
     * Batched edge traversal: given many source records, load the entities on
     * the far side of `edgeName` in a single round-trip and return them grouped
     * by source id.  This is the no-N+1 way to walk a level of the graph (e.g.
     * load the Domain for 100 Experiments with one query, not 100).
     *
     * Supports "out" edges (the foreign-key replacements).  Inbound collections
     * are resolved by query (EntityQuery.connectedTo), not here.
     */
    async related<Target extends Record<string, unknown>>(
        ctx: ServerContext,
        sources: EntityRecord[],
        schema: EntitySchema,
        edgeName: string,
    ): Promise<Map<string, EntityRecord<Target>[]>> {
        const def = schema.edges?.[edgeName];
        if (!def) {
            throw new Error(`EntityStore.related: schema has no edge "${edgeName}"`);
        }
        if ((def.direction ?? "out") !== "out") {
            throw new Error(
                `EntityStore.related: edge "${edgeName}" is inbound; use ctx.entities(...).connectedTo()`,
            );
        }
        if (!def.target) {
            throw new Error(
                `EntityStore.related: edge "${edgeName}" is polymorphic (no target schema); load targets explicitly`,
            );
        }
        const targetSchema = def.target() as EntitySchema<Target>;

        const perSource = new Map<string, string[]>();
        const allIris = new Set<string>();
        for (const src of sources) {
            const handle = src.edges?.[edgeName];
            const iris = handle ? ("iris" in handle ? handle.iris : [handle.iri]) : [];
            perSource.set(src.id, iris);
            for (const iri of iris) {
                allIris.add(iri);
            }
        }

        const targets = await this.hydrateMany(ctx, targetSchema, [...allIris]);
        const byIri = new Map(targets.map((t) => [t.iri, t]));

        const result = new Map<string, EntityRecord<Target>[]>();
        for (const src of sources) {
            const records: EntityRecord<Target>[] = [];
            for (const iri of perSource.get(src.id) ?? []) {
                const rec = byIri.get(iri);
                if (rec) {
                    records.push(rec);
                }
            }
            result.set(src.id, records);
        }
        return result;
    }

    /**
     * Executes a traversal plan against a set of root records, loading related
     * entities in one batch per depth level.  Returns HydratedRecord[] with a
     * `related` map keyed by edge name.  Absent edge targets are null.
     */
    async hydrateWithPlan<Props extends Record<string, unknown>>(
        ctx: ServerContext,
        records: EntityRecord<Props>[],
        plan: TraversalPlan,
    ): Promise<HydratedRecord<Props>[]> {
        const result: HydratedRecord<Props>[] = records.map((r) => ({
            ...r,
            related: {} as Record<string, EntityRecord | null>,
        }));

        for (const step of plan.steps) {
            const allIris = new Set<string>();
            for (const r of result) {
                const handle = r.edges?.[step.edgeName];
                if (!handle) {
                    continue;
                }
                const iris = "iris" in handle ? handle.iris : [handle.iri];
                for (const iri of iris) {
                    allIris.add(iri);
                }
            }

            const loaded = await this.hydrateMany(ctx, step.targetSchema, [...allIris]);
            const byIri = new Map(loaded.map((r) => [r.iri, r]));

            for (const r of result) {
                const handle = r.edges?.[step.edgeName];
                if (step.cardinality === "one") {
                    const iri = handle
                        ? "iri" in handle
                            ? handle.iri
                            : handle.iris[0]
                        : undefined;
                    r.related[step.edgeName] = iri ? (byIri.get(iri) ?? null) : null;
                } else {
                    const iris = handle && "iris" in handle ? handle.iris : [];
                    const targets = iris
                        .map((iri) => byIri.get(iri) ?? null)
                        .filter(Boolean) as EntityRecord[];
                    r.related[step.edgeName] =
                        targets.length > 0 ? (targets as unknown as EntityRecord) : null;
                }
            }
        }

        return result;
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private _cvs(): CollectionViewStore {
        if (!this._cvsInstance) {
            this._cvsInstance = new CollectionViewStore(this._store);
        }
        return this._cvsInstance;
    }

    private async _hydrate<Props extends Record<string, unknown>>(
        ctx: ServerContext,
        schema: EntitySchema<Props>,
        id: string,
        entIri: string,
        graph?: IRI | null,
    ): Promise<EntityRecord<Props>> {
        const entNode = { value: entIri } as IRI;
        const quads = await this._store.find(ctx, { subject: entNode, graph });
        const ts = await this._store.entityTimestamps(ctx, [entNode], graph);
        return this._recordFromQuads(ctx, schema, id, entIri, quads, ts.get(entIri));
    }

    /**
     * Builds an EntityRecord from a subject's quads — no DB access.  PII
     * properties are decrypted here (the only place loaded literals become typed
     * props), so callers receive cleartext while the store keeps ciphertext.
     */
    private _recordFromQuads<Props extends Record<string, unknown>>(
        ctx: ServerContext,
        schema: EntitySchema<Props>,
        id: string,
        entIri: string,
        quads: Quad[],
        timestamps?: EntityTimestamps,
    ): EntityRecord<Props> {
        const propByName = schema.properties as Record<string, IRI | PropertyDef>;
        const iriToName = invertPropertyMap(schema.properties);
        const edgePredToName = outEdgePredMap(schema);

        const raw: Record<string, unknown[]> = {};
        const edgeTargets: Record<string, string[]> = {};
        let schemaVersion: string | undefined;
        for (const q of quads) {
            const predStr = (q.predicate as IRI).value;
            if (predStr === RDF_TYPE.value) {
                continue;
            }
            if (predStr === SCHEMA_VERSION_PREDICATE.value) {
                schemaVersion = String(fromLiteral(q.object));
                continue;
            }
            const edgeName = edgePredToName.get(predStr);
            if (edgeName) {
                const targetIri = objectIri(q.object);
                if (targetIri) {
                    if (!edgeTargets[edgeName]) {
                        edgeTargets[edgeName] = [];
                    }
                    edgeTargets[edgeName]?.push(targetIri);
                }
                continue;
            }
            const propName = iriToName.get(predStr);
            /* v8 ignore next -- defensive: unknown predicates on entity are skipped */
            if (!propName) {
                continue;
            }
            if (!raw[propName]) {
                raw[propName] = [];
            }
            const propDef = propByName[propName];
            const value = fromLiteral(q.object);
            raw[propName]?.push(propDef ? this._decryptValue(ctx, propDef, value) : value);
        }

        const props: Record<string, unknown> = {};
        for (const [k, vals] of Object.entries(raw)) {
            props[k] = vals.length === 1 ? vals[0] : vals;
        }

        const record: EntityRecord<Props> = {
            id,
            iri: entIri,
            props: props as Props,
            schemaVersion,
        };
        const edges = this._buildEdgeHandles(schema, edgeTargets);
        if (edges) {
            record.edges = edges;
        }
        if (timestamps) {
            record.createdAt = timestamps.createdAt;
            record.updatedAt = timestamps.updatedAt;
        }
        if (schemaVersion !== undefined && this._registry) {
            const current = this._registry.currentVersion(schema);
            if (!current.startsWith("0-") && schemaVersion !== current) {
                record.drift = { entityVersion: schemaVersion, currentVersion: current };
            }
        }
        return record;
    }

    /**
     * Builds the lazy edge handles for an entity's "out" edges.  Returns
     * undefined when the schema declares no out edges, so edgeless entities keep
     * their original `{ id, iri, props }` shape.
     */
    private _buildEdgeHandles(
        schema: EntitySchema,
        edgeTargets: Record<string, string[]>,
    ): Record<string, EdgeHandle> | undefined {
        const outEdges = Object.entries(schema.edges ?? {}).filter(
            ([, def]) => (def.direction ?? "out") === "out",
        );
        if (outEdges.length === 0) {
            return undefined;
        }

        const handles: Record<string, EdgeHandle> = {};
        for (const [name, def] of outEdges) {
            const targets = edgeTargets[name] ?? [];
            if ((def.cardinality ?? "one") === "many") {
                handles[name] = this._edgeSet(def, targets);
            } else if (targets.length > 0) {
                handles[name] = this._edgeRef(def, targets[0]);
            }
        }
        return handles;
    }

    private _edgeRef(def: EdgeDef, targetIri: string): EdgeRef {
        const targetThunk = def.target;
        const id = idFromIri(targetIri);
        return {
            iri: targetIri,
            id,
            load: targetThunk
                ? (ctx) => this.findById(ctx as ServerContext, targetThunk(), id)
                : () =>
                      Promise.reject(
                          new Error("EdgeRef.load: edge has no target schema (polymorphic edge)"),
                      ),
        };
    }

    private _edgeSet(def: EdgeDef, targetIris: string[]): EdgeSet {
        const targetThunk = def.target;
        return {
            iris: targetIris,
            ids: targetIris.map(idFromIri),
            load: targetThunk
                ? (ctx) => this.hydrateMany(ctx as ServerContext, targetThunk(), targetIris)
                : () =>
                      Promise.reject(
                          new Error("EdgeSet.load: edge has no target schema (polymorphic edge)"),
                      ),
        };
    }

    private _propQuads(
        ctx: ServerContext,
        ent: IRI,
        schema: EntitySchema,
        data: Record<string, unknown>,
        graph: IRI | DefaultGraph = DEFAULT_GRAPH,
    ) {
        const results: Parameters<TripleStore["insert"]>[1][] = [];
        for (const [propName, propValue] of Object.entries(
            schema.properties as Record<string, IRI | PropertyDef>,
        )) {
            const value = data[propName];
            if (value === undefined || value === null) {
                continue;
            }
            const predIri = propIri(propValue);
            if (Array.isArray(value)) {
                for (const v of value) {
                    results.push({
                        subject: ent,
                        predicate: predIri,
                        object: this._propObject(ctx, propValue, v),
                        graph,
                    });
                }
            } else {
                results.push({
                    subject: ent,
                    predicate: predIri,
                    object: this._propObject(ctx, propValue, value),
                    graph,
                });
            }
        }
        return results;
    }

    private _applyDefaults<Props extends Record<string, unknown>>(
        schema: EntitySchema<Props>,
        data: Partial<Props>,
    ): Record<string, unknown> {
        if (!schema.defaults) {
            return data as Record<string, unknown>;
        }
        const result = { ...data } as Record<string, unknown>;
        for (const [key, defaultVal] of Object.entries(schema.defaults)) {
            if (result[key] === undefined) {
                result[key] =
                    typeof defaultVal === "function" ? (defaultVal as () => unknown)() : defaultVal;
            }
        }
        return result;
    }

    private _validate(schema: EntitySchema, data: Record<string, unknown>): void {
        if (!schema.shape) {
            return;
        }
        const result = validate(data, schema.shape, propertyMapFor(schema.properties));
        if (!result.valid) {
            throw new EntityValidationError(result.violations);
        }
    }
}

// ── Private helpers ───────────────────────────────────────────────────────────

import { randomBytes } from "node:crypto";

function _newId(): string {
    return randomBytes(16).toString("hex");
}

/** Returns only the declared literal-property keys from an input object. */
function pickProps(schema: EntitySchema, data: Record<string, unknown>): Record<string, unknown> {
    const props: Record<string, unknown> = {};
    for (const key of Object.keys(schema.properties)) {
        if (data[key] !== undefined) {
            props[key] = data[key];
        }
    }
    return props;
}

/** Maps predicate IRI → edge name for a schema's "out" edges. */
function outEdgePredMap(schema: EntitySchema): Map<string, string> {
    const map = new Map<string, string>();
    for (const [name, def] of Object.entries(schema.edges ?? {})) {
        if ((def.direction ?? "out") === "out") {
            map.set(def.predicate.value, name);
        }
    }
    return map;
}

/** Returns the IRI string of a quad object when it is an IRI node, else null. */
function objectIri(object: Quad["object"]): string | null {
    if (object && typeof object === "object" && !("termType" in object)) {
        return (object as IRI).value;
    }
    return null;
}

/**
 * True when `quads` (a subject's quads within one graph) contain the rdf:type
 * triple for `typeIRI`.  Used to reject subjects with no type quad in the scoped
 * graph so foreign-tenant IRIs never hydrate into ghost records.
 */
function hasTypeQuad(quads: Quad[] | undefined, typeIRI: IRI): boolean {
    if (!quads) {
        return false;
    }
    return quads.some(
        (q) =>
            (q.predicate as IRI).value === RDF_TYPE.value &&
            (q.object as IRI)?.value === typeIRI.value,
    );
}

// ── Edge write helpers ──────────────────────────────────────────────────────────

/** A value supplied for an edge: a target id, a full target IRI, or a record. */
export type EdgeInput = string | EntityRecord;

/**
 * Create/update input.  Literal properties are typed by `Props`; edge values are
 * supplied under their edge name (a target id, IRI, or record).  The index
 * signature admits edge keys without losing type-checking on the `Props` keys.
 */
export type EntityInput<Props extends Record<string, unknown>> = Partial<Props> &
    Record<string, unknown>;

interface ResolvedEdge {
    predicate: IRI;
    targetIris: string[];
}

/** Resolves the "out" edge values present in `data` to concrete target IRIs. */
function resolveEdgeTargets(schema: EntitySchema, data: Record<string, unknown>): ResolvedEdge[] {
    const resolved: ResolvedEdge[] = [];
    for (const [name, def] of Object.entries(schema.edges ?? {})) {
        if ((def.direction ?? "out") !== "out") {
            continue;
        }
        const value = data[name];
        if (value === undefined || value === null) {
            continue;
        }
        const targetSchema = def.target?.();
        const values = Array.isArray(value) ? value : [value];
        resolved.push({
            predicate: def.predicate,
            targetIris: values.map((v) => edgeTargetIri(v as EdgeInput, targetSchema)),
        });
    }
    return resolved;
}

/**
 * Resolves a single edge input (id, IRI, or record) to the target entity's IRI.
 * A bare id requires `targetSchema` to build the IRI; a polymorphic edge (no
 * target) therefore accepts only a full IRI or a record.
 */
export function edgeTargetIri(value: EdgeInput, targetSchema?: EntitySchema): string {
    if (typeof value === "object" && value !== null && "iri" in value) {
        return (value as EntityRecord).iri;
    }
    const str = String(value);
    // Absolute IRI (has a scheme, e.g. urn:… or http://…) — use as-is.
    // Bare entity ids are scheme-less (hex / sys-prefixed), so this distinguishes them.
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(str)) {
        return str;
    }
    if (!targetSchema) {
        throw new Error(
            `edgeTargetIri: "${str}" is a bare id but the edge is polymorphic (no target schema); pass a full IRI or a record`,
        );
    }
    return entityIriFor(targetSchema, str).value;
}

/** Builds the IRI-object quads for a set of resolved edges. */
function edgeQuads(
    subject: IRI,
    edges: ResolvedEdge[],
    graph: IRI | DefaultGraph,
): Array<Parameters<TripleStore["insert"]>[1]> {
    const quads: Array<Parameters<TripleStore["insert"]>[1]> = [];
    for (const edge of edges) {
        for (const targetIri of edge.targetIris) {
            quads.push({
                subject,
                predicate: edge.predicate,
                object: { value: targetIri } as IRI,
                graph,
            });
        }
    }
    return quads;
}

/** Inverts resolved edges into the predicate→targets map keyed by edge name. */
function edgeTargetMap(schema: EntitySchema, edges: ResolvedEdge[]): Record<string, string[]> {
    const predToName = new Map(
        Object.entries(schema.edges ?? {}).map(([name, def]) => [def.predicate.value, name]),
    );
    const map: Record<string, string[]> = {};
    for (const edge of edges) {
        const name = predToName.get(edge.predicate.value);
        if (name) {
            map[name] = edge.targetIris;
        }
    }
    return map;
}
