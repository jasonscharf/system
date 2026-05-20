import { FlowComponent, FlowContext } from '@jasonscharf/flow';

import { describe, expect, it } from 'vitest';


describe(FlowComponent.name, () => {
    it('generates an id when none is provided', () => {
        const ctx = new FlowContext();
        const c = new FlowComponent({ context: ctx });
        expect(c.id).toBeInstanceOf(Uint8Array);
        expect((c.id as Uint8Array).length).toBe(16);
    });

    it('uses the provided id', () => {
        const ctx = new FlowContext();
        const id = new Uint8Array(16).fill(1);
        const c = new FlowComponent({ id, context: ctx });
        expect(c.id).toBe(id);
    });

    it('defaults name to empty string', () => {
        const ctx = new FlowContext();
        const c = new FlowComponent({ context: ctx });
        expect(c.name).toBe('');
    });

    it('uses the provided name', () => {
        const ctx = new FlowContext();
        const c = new FlowComponent({ name: 'my-component', context: ctx });
        expect(c.name).toBe('my-component');
    });
});
