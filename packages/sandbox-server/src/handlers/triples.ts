import { okResult, errResult, TERN_TYPES, type IRI, type BlankNode, type Literal, type TernRequest, type TernResult } from '@jasonscharf/core';
import { TripleStore, noCtx, type QuadPattern } from '@jasonscharf/data';
import type { HandlerContext } from '@jasonscharf/app';


type RdfTerm = IRI | BlankNode | Literal;

function makeIRI(value: string): IRI { return { value } as IRI; }

function termFromWire(raw: unknown): RdfTerm | undefined {
    if (!raw || typeof raw !== 'object') { return undefined; }
    const r = raw as Record<string, unknown>;
    if (typeof r['value'] === 'string' && !('termType' in r)) {
        return makeIRI(r['value']);
    }
    if (r['termType'] === 'BlankNode' && typeof r['id'] === 'string') {
        return { termType: 'BlankNode', id: r['id'] };
    }
    if (r['termType'] === 'Literal' && typeof r['value'] === 'string') {
        return {
            termType: 'Literal',
            value:    r['value'] as string,
            datatype: makeIRI(typeof r['datatype'] === 'string' ? r['datatype']
                              : 'http://www.w3.org/2001/XMLSchema#string'),
            language: typeof r['lang'] === 'string' ? r['lang'] : undefined,
        };
    }
    return undefined;
}

function patternFromWire(raw: unknown): QuadPattern {
    if (!raw || typeof raw !== 'object') { return {}; }
    const r = raw as Record<string, unknown>;
    return {
        subject:   termFromWire(r['subject'])   as IRI | BlankNode | undefined,
        predicate: termFromWire(r['predicate']) as IRI | undefined,
        object:    termFromWire(r['object'])    as RdfTerm | undefined,
        graph:     termFromWire(r['graph'])     as IRI | undefined,
    };
}

function getStore(ctx: HandlerContext): TripleStore {
    const store = ctx['store'];
    if (!(store instanceof TripleStore)) {
        throw new Error('HandlerContext.store must be a TripleStore instance');
    }
    return store;
}

export async function handleFind(request: TernRequest, ctx: HandlerContext): Promise<TernResult> {
    const store   = getStore(ctx);
    const pattern = patternFromWire(request.payload);
    const quads   = await store.find(noCtx, pattern);
    return okResult(request.id, TERN_TYPES.tripleFind, { quads });
}

export async function handleInsert(request: TernRequest, ctx: HandlerContext): Promise<TernResult> {
    const store   = getStore(ctx);
    const payload = request.payload as Record<string, unknown> | undefined;
    if (!payload) {
        return errResult(request.id, TERN_TYPES.tripleInsert, 'Missing payload');
    }
    await store.insert(noCtx, {
        subject:   termFromWire(payload['subject'])!   as IRI | BlankNode,
        predicate: termFromWire(payload['predicate'])! as IRI,
        object:    termFromWire(payload['object'])!    as RdfTerm,
        graph:     (termFromWire(payload['graph'])     as IRI | undefined) ?? makeIRI(''),
    });
    return okResult(request.id, TERN_TYPES.tripleInsert);
}

export async function handleStats(request: TernRequest, ctx: HandlerContext): Promise<TernResult> {
    const store = getStore(ctx);
    const stats = await store.stats(noCtx);
    return okResult(request.id, TERN_TYPES.tripleStats, stats);
}
