import { FlowComponent } from '@system/core';

import { describe, expect, it } from 'vitest';


describe(FlowComponent.name, () => {
    it('generates an id when none is provided', () => {
        const c = new FlowComponent({});
        expect(c.id).toBeInstanceOf(Uint8Array);
        expect((c.id as Uint8Array).length).toBe(16);
    });

    it('uses the provided id', () => {
        const id = new Uint8Array(16).fill(1);
        const c = new FlowComponent({ id });
        expect(c.id).toBe(id);
    });

    it('defaults name to empty string', () => {
        const c = new FlowComponent({});
        expect(c.name).toBe('');
    });

    it('uses the provided name', () => {
        const c = new FlowComponent({ name: 'my-component' });
        expect(c.name).toBe('my-component');
    });
});
