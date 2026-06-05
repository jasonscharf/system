import type { IRI } from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { EntityRecord, EntitySchema, FilterOp } from "@jasonscharf/entities";
import { RDF_TYPE, toLiteral } from "@jasonscharf/entities";
import { EntityStore } from "./EntityStore.js";
import type { ServerContext } from "./ServerContext.js";

export type { FilterOp };

interface Filter {
    prop: string;
    op: FilterOp;
    value: unknown;
}

interface OrderClause {
    prop: string;
    dir: "asc" | "desc";
}

export class EntityQuery<Props extends Record<string, unknown>> {
    private readonly _es: EntityStore;
    private _filters: Filter[] = [];
    private _order?: OrderClause;
    private _limit?: number;
    private _offset?: number;

    constructor(
        private readonly _store: TripleStore,
        private readonly _schema: EntitySchema<Props>,
    ) {
        this._es = new EntityStore(_store);
    }

    where(prop: keyof Props & string, op: FilterOp, value: unknown): this {
        this._filters.push({ prop, op, value });
        return this;
    }

    orderBy(prop: keyof Props & string, dir: "asc" | "desc" = "asc"): this {
        this._order = { prop, dir };
        return this;
    }

    limit(n: number): this {
        this._limit = n;
        return this;
    }

    offset(n: number): this {
        this._offset = n;
        return this;
    }

    async all(ctx: ServerContext): Promise<EntityRecord<Props>[]> {
        return this._store.withTransaction(ctx, async (txCtx) => {
            let candidateIris = await this._allEntityIris(txCtx);

            const eqFilters = this._filters.filter((f) => f.op === "=");
            const otherFilters = this._filters.filter((f) => f.op !== "=");

            for (const f of eqFilters) {
                candidateIris = await this._applyEqFilter(txCtx, candidateIris, f);
            }

            let records = await this._es.hydrateMany(txCtx, this._schema, candidateIris);

            for (const f of otherFilters) {
                records = records.filter((r) => this._matchFilter(r, f));
            }

            if (this._order) {
                const { prop, dir } = this._order;
                records.sort((a, b) => {
                    const av = a.props[prop];
                    const bv = b.props[prop];
                    if (av === bv) {
                        return 0;
                    }
                    const cmp = av == null ? -1 : bv == null ? 1 : av < bv ? -1 : 1;
                    return dir === "asc" ? cmp : -cmp;
                });
            }

            const start = this._offset ?? 0;
            const end = this._limit !== undefined ? start + this._limit : undefined;
            return records.slice(start, end);
        });
    }

    async first(ctx: ServerContext): Promise<EntityRecord<Props> | null> {
        const results = await this.limit(1).all(ctx);
        return results[0] ?? null;
    }

    async count(ctx: ServerContext): Promise<number> {
        return this._store.withTransaction(ctx, async (txCtx) => {
            let iris = await this._allEntityIris(txCtx);
            for (const f of this._filters.filter((ff) => ff.op === "=")) {
                iris = await this._applyEqFilter(txCtx, iris, f);
            }
            return iris.length;
        });
    }

    async create(ctx: ServerContext, data: Partial<Props>): Promise<EntityRecord<Props>> {
        return this._es.create(ctx, this._schema, data);
    }

    async save(ctx: ServerContext, record: EntityRecord<Props>): Promise<void> {
        return this._es.update(ctx, this._schema, record.id, record.props);
    }

    async delete(ctx: ServerContext, id: string): Promise<void> {
        return this._es.delete(ctx, this._schema, id);
    }

    get store(): TripleStore {
        return this._store;
    }

    // ── Static / free function ────────────────────────────────────────────────

    /** Convenience: start a query from a raw store (no ctx required at this point). */
    static from<Props extends Record<string, unknown>>(
        store: TripleStore,
        schema: EntitySchema<Props>,
    ): EntityQuery<Props> {
        return new EntityQuery(store, schema);
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private async _allEntityIris(ctx: ServerContext): Promise<string[]> {
        const quads = await this._store.find(ctx, {
            predicate: RDF_TYPE,
            object: this._schema.typeIRI,
        });
        return quads.map((q) => (q.subject as IRI).value);
    }

    private async _applyEqFilter(ctx: ServerContext, iris: string[], f: Filter): Promise<string[]> {
        const propIri = (this._schema.properties as Record<string, IRI>)[f.prop];
        if (!propIri) {
            return iris;
        }

        const valueNode = toLiteral(f.value);
        const propQuads = await this._store.find(ctx, { predicate: propIri, object: valueNode });
        const matchingEntities = new Set(propQuads.map((q) => (q.subject as IRI).value));

        return iris.filter((iri) => matchingEntities.has(iri));
    }

    private _matchFilter(record: EntityRecord<Props>, f: Filter): boolean {
        const value = record.props[f.prop];
        switch (f.op) {
            case "!=":
                return value !== f.value;
            case "<":
                return (value as number) < (f.value as number);
            case "<=":
                return (value as number) <= (f.value as number);
            case ">":
                return (value as number) > (f.value as number);
            case ">=":
                return (value as number) >= (f.value as number);
            case "LIKE":
            case "ILIKE": {
                const pat = String(f.value).replace(/%/g, ".*").replace(/_/g, ".");
                const flags = f.op === "ILIKE" ? "i" : "";
                return typeof value === "string" && new RegExp(`^${pat}$`, flags).test(value);
            }
            default:
                return false;
        }
    }
}
