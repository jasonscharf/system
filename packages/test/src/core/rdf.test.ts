import { IRI } from '@system/core';
import { blankNode } from '@system/core';
import { literal } from '@system/core';
import { DEFAULT_GRAPH } from '@system/core';
import { triple, quad } from '@system/core';

import { describe, expect, it } from 'vitest';


describe('BlankNode', () => {
    it('has termType BlankNode', () => {
        const bn = blankNode('b0');
        expect(bn.termType).toBe('BlankNode');
        expect(bn.id).toBe('b0');
    });
});

describe('DefaultGraph', () => {
    it('has termType DefaultGraph', () => {
        expect(DEFAULT_GRAPH.termType).toBe('DefaultGraph');
    });
});

describe('Literal', () => {
    const xsdString = new IRI('http://www.w3.org/2001/XMLSchema#string');

    it('has termType Literal', () => {
        const lit = literal('hello', xsdString);
        expect(lit.termType).toBe('Literal');
        expect(lit.value).toBe('hello');
        expect(lit.datatype).toBe(xsdString);
        expect(lit.language).toBeUndefined();
    });

    it('stores language tag', () => {
        const lit = literal('hello', xsdString, 'en');
        expect(lit.language).toBe('en');
    });
});

describe('Triple / Quad', () => {
    const s = new IRI('http://s');
    const p = new IRI('http://p');
    const o = new IRI('http://o');
    const g = new IRI('http://g');

    it('creates a triple', () => {
        const t = triple(s, p, o);
        expect(t.subject).toBe(s);
        expect(t.predicate).toBe(p);
        expect(t.object).toBe(o);
    });

    it('creates a quad', () => {
        const q = quad(s, p, o, g);
        expect(q.graph).toBe(g);
    });

    it('creates a quad with default graph', () => {
        const q = quad(s, p, o, DEFAULT_GRAPH);
        expect(q.graph).toBe(DEFAULT_GRAPH);
    });
});
