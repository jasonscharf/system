import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { IRI } from '@jasonscharf/core';
import { triple } from '@jasonscharf/core';
import { TripleStream } from '@jasonscharf/core';
import { FileSource } from '@jasonscharf/core';
import { HttpSource } from '@jasonscharf/core';
import { SocketSource } from '@jasonscharf/core';
import { DatabaseSource } from '@jasonscharf/core';
import { flush } from '@jasonscharf/core';
import type { Triple, TripleSource } from '@jasonscharf/core';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';


const t1 = triple(new IRI('http://s1'), new IRI('http://p'), new IRI('http://o1'));
const t2 = triple(new IRI('http://s2'), new IRI('http://p'), new IRI('http://o2'));

function mockSource(triples: Triple[]): TripleSource {
    return {
        async *stream() {
            for (const triple of triples) yield triple;
        },
    };
}

describe('TripleStream', () => {
    it('iterates through source triples', async () => {
        const stream = new TripleStream(mockSource([t1, t2]));
        const results: Triple[] = [];
        for await (const t of stream) results.push(t);
        expect(results).toEqual([t1, t2]);
    });

    it('collect() returns all triples', async () => {
        expect(await new TripleStream(mockSource([t1, t2])).collect()).toEqual([t1, t2]);
    });

    it('filter() keeps matching triples', async () => {
        const stream = new TripleStream(mockSource([t1, t2]));
        const filtered = await stream.filter(t => t.subject instanceof IRI && t.subject.equals(new IRI('http://s1'))).collect();
        expect(filtered).toEqual([t1]);
    });

    it('map() transforms each triple', async () => {
        const replacement = triple(new IRI('http://x'), new IRI('http://y'), new IRI('http://z'));
        const mapped = await new TripleStream(mockSource([t1])).map(() => replacement).collect();
        expect(mapped).toEqual([replacement]);
    });

    it('take() limits the number of triples', async () => {
        expect(await new TripleStream(mockSource([t1, t2])).take(1).collect()).toEqual([t1]);
    });

    it('take() returns empty when limit is 0', async () => {
        expect(await new TripleStream(mockSource([t1, t2])).take(0).collect()).toEqual([]);
    });
});

describe('FileSource', () => {
    let tmpDir: string;

    beforeEach(async () => { tmpDir = await mkdtemp(join(tmpdir(), 'tern-hydration-')); });
    afterEach(async () => { await rm(tmpDir, { recursive: true }); });

    it('reads the file and passes its content to the parser', async () => {
        const filePath = join(tmpDir, 'data.txt');
        await writeFile(filePath, 'hello');

        const parser = vi.fn(async function* (content: string) {
            if (content === 'hello') yield t1;
        });

        const results = await new TripleStream(new FileSource(filePath, parser)).collect();
        expect(parser).toHaveBeenCalledWith('hello');
        expect(results).toEqual([t1]);
    });
});

describe('HttpSource', () => {
    beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
    afterEach(() => vi.unstubAllGlobals());

    it('streams triples from HTTP response', async () => {
        vi.mocked(fetch).mockResolvedValue({ ok: true, text: async () => 'content' } as Response);
        const parser = vi.fn(async function* () { yield t1; });
        expect(await new TripleStream(new HttpSource('http://example.org/', parser)).collect()).toEqual([t1]);
    });

    it('passes custom RequestInit', async () => {
        vi.mocked(fetch).mockResolvedValue({ ok: true, text: async () => '' } as Response);
        const init = { credentials: 'include' as RequestCredentials };
        await new TripleStream(new HttpSource('http://example.org/', vi.fn(async function* () {}), init)).collect();
        expect(vi.mocked(fetch)).toHaveBeenCalledWith('http://example.org/', expect.objectContaining(init));
    });

    it('throws on non-OK response', async () => {
        vi.mocked(fetch).mockResolvedValue({ ok: false, status: 404 } as Response);
        await expect(
            new TripleStream(new HttpSource('http://example.org/', vi.fn(async function* () {}))).collect()
        ).rejects.toThrow('404');
    });
});

describe('DatabaseSource', () => {
    it('streams triples from the store', async () => {
        const store = { async *query() { yield t1; yield t2; } };
        expect(await new TripleStream(new DatabaseSource(store)).collect()).toEqual([t1, t2]);
    });

    it('passes pattern to the store', async () => {
        const query = vi.fn(async function* () {});
        const pattern = { predicate: new IRI('http://p') };
        await new TripleStream(new DatabaseSource({ query }, pattern)).collect();
        expect(query).toHaveBeenCalledWith(pattern);
    });
});

describe('SocketSource', () => {
    let mockSocket: {
        listeners: Record<string, ((e?: any) => void)[]>;
        emit: (event: string, data?: unknown) => void;
    };

    class MockWebSocket {
        listeners: Record<string, ((e?: any) => void)[]> = {};
        constructor(_url: string) { mockSocket = this as any; }
        addEventListener(event: string, fn: (e?: any) => void) {
            (this.listeners[event] ??= []).push(fn);
        }
        emit(event: string, data?: unknown) {
            for (const fn of this.listeners[event] ?? []) fn(data !== undefined ? { data } : undefined);
        }
    }

    beforeEach(() => vi.stubGlobal('WebSocket', MockWebSocket));
    afterEach(() => vi.unstubAllGlobals());

    it('yields triples from socket messages', async () => {
        const deserializer = vi.fn(() => [t1]);
        const source = new SocketSource('ws://test', deserializer);
        const results: Triple[] = [];

        const consuming = (async () => {
            for await (const t of source.stream()) results.push(t);
        })();

        await flush();
        mockSocket.emit('open');
        await flush();
        mockSocket.emit('message', 'payload');
        await flush();
        mockSocket.emit('close');
        await flush();
        await consuming;

        expect(results).toEqual([t1]);
    });

    it('throws when connection cannot be established', async () => {
        const source = new SocketSource('ws://bad', vi.fn(() => []));
        const iter = source.stream()[Symbol.asyncIterator]();
        const next = iter.next();
        await flush();
        mockSocket.emit('error');
        await expect(next).rejects.toThrow('Cannot connect');
    });

    it('handles multiple buffered messages without blocking', async () => {
        let call = 0;
        const deserializer = vi.fn(() => [call++ === 0 ? t1 : t2]);
        const source = new SocketSource('ws://test', deserializer);
        const results: Triple[] = [];

        const consuming = (async () => {
            for await (const t of source.stream()) results.push(t);
        })();

        await flush();
        mockSocket.emit('open');
        await flush();

        // Emit two messages without flushing so they queue up
        mockSocket.emit('message', 'first');
        mockSocket.emit('message', 'second');
        mockSocket.emit('close');

        await flush();
        await flush();
        await consuming;

        expect(results).toHaveLength(2);
    });

    it('throws on errors during streaming', async () => {
        const source = new SocketSource('ws://test', vi.fn(() => []));
        let caughtError: unknown;

        const consuming = (async () => {
            try {
                for await (const _ of source.stream()) { /* consume */ }
            } catch (e) {
                caughtError = e;
            }
        })();

        await flush();
        mockSocket.emit('open');
        await flush();
        mockSocket.emit('error');
        await flush();
        await consuming;

        expect(caughtError).toBeInstanceOf(Error);
    });
});
