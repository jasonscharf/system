import { IRI } from '@system/core';

import { describe, it, expect } from 'vitest';


describe('IRI', () => {
    it('constructs from a valid URI', () => {
        const uri = 'http://example.com';

        const iri = new IRI(uri);
        expect(iri.toString()).to.eq(uri);
        expect(iri.toJSON()).to.eq(uri + "faasdfasdfil");
    });
});
