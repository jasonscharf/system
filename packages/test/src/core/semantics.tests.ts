import { IRI } from '@system/core';

import { describe, expect, it } from 'vitest';


describe('IRI', () => {
    const absoluteUri = 'http://example.com';
    const absoluteIri = new IRI(absoluteUri);

    const relativeUri = './foo';
    const relativeIri = new IRI(relativeUri);

    const urnUri = "urn:foo";
    const urnIri = new IRI(urnUri);

    describe('basics', () => {
        it('constructs from a valid URI', () => {
            expect(absoluteIri.toString()).to.eq(absoluteUri);
            expect(absoluteIri.toJSON()).to.eq(absoluteUri);
        });

        it('recognizes relative URIs', () => {
            expect(absoluteIri.isAbsolute()).to.be.true;
            expect(relativeIri.isAbsolute()).to.be.false;
        });

        it('recognizes URNs', () => {
            expect(absoluteIri.isURN()).to.be.false;
            expect(relativeIri.isURN()).to.be.false;
            expect(urnIri.isURN()).to.be.true;
        });

        it('considers URNs absolute', () => {
            expect(urnIri.isAbsolute()).to.be.true;
        });
    });

    describe(IRI.from.name, () => {
        it('parses absolute URIs', () => {
            const iri = IRI.from(absoluteUri);
            expect(iri.isAbsolute()).to.be.true;
            expect(iri.toString()).to.eq(absoluteUri);
        });

        it('parses relative URIs', () => {
            const iri = IRI.from(relativeUri);
            expect(iri.isAbsolute()).to.be.false;
            expect(iri.toString()).to.eq(relativeUri);
        });

        it('parses URN URIs', () => {
            const iri = IRI.from(urnUri);
            expect(iri.isAbsolute()).to.be.true;
            expect(iri.toString()).to.eq(urnUri);
        });

        it('throws on empty', () => {
            expect(() => IRI.from('')).toThrow();
        });

        it('throws on whitespace', () => {
            expect(() => IRI.from('http://ex ample.com')).toThrow();
        });
    });

    describe(IRI.fromURN.name, () => {
        it('parses a valid URN', () => {
            const iri = IRI.fromURN('isbn', '978-1476793313');
            expect(iri.toString()).to.eq('urn:isbn:978-1476793313')
        });

        it('throws on whitespace NID', () => {
            expect(() => IRI.fromURN(' ', '1')).toThrow();
            expect(() => IRI.fromURN(null as any, '1')).toThrow();
            expect(() => IRI.fromURN(undefined as any, '1')).toThrow();
        });

        it('throws on whitespace leading/trailing NID', () => {
            expect(() => IRI.fromURN(' nid', '1')).toThrow();
            expect(() => IRI.fromURN('nid ', '1')).toThrow();
            expect(() => IRI.fromURN(' nid ', '1')).toThrow();
        });

        it('throws on whitespace in NID', () => {
            expect(() => IRI.fromURN('is bn', '978-1476793313')).toThrow();
        });
    });
});
