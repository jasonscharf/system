import type { IRI } from '@jasonscharf/core';
import type { TripleStore } from '@jasonscharf/data';
import type { EntityHandle, EntitySchema, EntityRecord } from '@jasonscharf/entities';
import { RDF_TYPE, TERN_PROP_GROUP, toLiteral } from '@jasonscharf/entities';
import type { ServerContext } from './ServerContext.js';
import { EntityStore } from './EntityStore.js';


export type FilterOp = '=' | '!=' | '<' | '<=' | '>' | '>=' | 'LIKE' | 'ILIKE';

interface Filter {
    handle: EntityHandle;
    prop:   string;
    op:     FilterOp;
    value:  unknown;
}

interface OrderClause {
    handle: EntityHandle;
    prop:   string;
    dir:    'asc' | 'desc';
}

export class EntityQuery<H extends EntityHandle[]> {
    private readonly _es: EntityStore;
    private _filters:  Filter[]       = [];
    private _order?:   OrderClause;
    private _limit?:   number;
    private _offset?:  number;

    constructor(
        private readonly _store:   TripleStore,
        private readonly _schema:  EntitySchema<any>,
        private readonly _handles: H | '*',
    ) {
        this._es = new EntityStore(_store);
    }

    where(handle: EntityHandle, prop: string, op: FilterOp, value: unknown): this {
        this._filters.push({ handle, prop, op, value });
        return this;
    }

    orderBy(handle: EntityHandle, prop: string, dir: 'asc' | 'desc' = 'asc'): this {
        this._order = { handle, prop, dir };
        return this;
    }

    limit(n: number):  this { this._limit  = n; return this; }
    offset(n: number): this { this._offset = n; return this; }

    async all(ctx: ServerContext): Promise<EntityRecord[]> {
        let candidateIris = await this._allEntityIris(ctx);

        const eqFilters    = this._filters.filter(f => f.op === '=');
        const otherFilters = this._filters.filter(f => f.op !== '=');

        for (const f of eqFilters) {
            candidateIris = await this._applyEqFilter(ctx, candidateIris, f);
        }

        let records = await this._es.hydrateMany(ctx, this._schema, candidateIris, this._handles);

        for (const f of otherFilters) {
            records = records.filter(r => this._matchFilter(r, f));
        }

        if (this._order) {
            const { handle, prop, dir } = this._order;
            records.sort((a, b) => {
                const av = a.groups[handle.id]?.[prop];
                const bv = b.groups[handle.id]?.[prop];
                if (av === bv) { return 0; }
                const cmp = av == null ? -1 : bv == null ? 1 : (av < bv ? -1 : 1);
                return dir === 'asc' ? cmp : -cmp;
            });
        }

        const start = this._offset ?? 0;
        const end   = this._limit  !== undefined ? start + this._limit : undefined;
        return records.slice(start, end);
    }

    async first(ctx: ServerContext): Promise<EntityRecord | null> {
        const results = await this.limit(1).all(ctx);
        return results[0] ?? null;
    }

    async count(ctx: ServerContext): Promise<number> {
        let iris = await this._allEntityIris(ctx);
        for (const f of this._filters.filter(ff => ff.op === '=')) {
            iris = await this._applyEqFilter(ctx, iris, f);
        }
        return iris.length;
    }

    get store(): TripleStore { return this._store; }

    // ── Private ───────────────────────────────────────────────────────────────

    private async _allEntityIris(ctx: ServerContext): Promise<string[]> {
        const quads = await this._store.find(ctx, { predicate: RDF_TYPE, object: this._schema.typeIRI });
        return quads.map(q => (q.subject as IRI).value);
    }

    private async _applyEqFilter(ctx: ServerContext, iris: string[], f: Filter): Promise<string[]> {
        const groupDef = this._schema.group(f.handle);
        if (!groupDef) { return iris; }
        const propIri = (groupDef.properties as Record<string, IRI>)[f.prop];
        if (!propIri) { return iris; }

        const valueNode  = toLiteral(f.value);
        const propQuads  = await this._store.find(ctx, { predicate: propIri, object: valueNode });
        const matchingPg = new Set(propQuads.map(q => (q.subject as IRI).value));

        if (matchingPg.size === 0) { return []; }

        const entSet = new Set<string>();
        for (const pgVal of matchingPg) {
            const pgNode   = { value: pgVal } as IRI;
            const entQuads = await this._store.find(ctx, { predicate: TERN_PROP_GROUP, object: pgNode });
            for (const q of entQuads) { entSet.add((q.subject as IRI).value); }
        }

        return iris.filter(iri => entSet.has(iri));
    }

    private _matchFilter(record: EntityRecord, f: Filter): boolean {
        const groupData = record.groups[f.handle.id];
        if (!groupData) { return false; }
        const value = groupData[f.prop];
        switch (f.op) {
            case '!=':   return value !== f.value;
            case '<':    return (value as any) <  (f.value as any);
            case '<=':   return (value as any) <= (f.value as any);
            case '>':    return (value as any) >  (f.value as any);
            case '>=':   return (value as any) >= (f.value as any);
            case 'LIKE':
            case 'ILIKE': {
                const pat   = String(f.value).replace(/%/g, '.*').replace(/_/g, '.');
                const flags = f.op === 'ILIKE' ? 'i' : '';
                return typeof value === 'string' && new RegExp(`^${pat}$`, flags).test(value);
            }
            default: return false;
        }
    }
}

// ── Entry point ───────────────────────────────────────────────────────────────

export function entities(store: TripleStore) {
    return {
        find<H extends EntityHandle[]>(
            schema:  EntitySchema<any>,
            handles: H | '*',
        ): EntityQuery<H> {
            return new EntityQuery<H>(store, schema, handles);
        },
    };
}
