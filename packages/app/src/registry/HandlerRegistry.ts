import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { errResult, type TernRequest, type TernResult, type TernTypeRef } from '@system/core';
import type { Dispatcher } from '../routing/Dispatcher.js';
import type { HandlerEntry } from '../config/types.js';


/**
 * The contract every handler function must satisfy.
 *
 * A handler receives the inbound TernRequest plus an opaque context object
 * whose shape is defined by the host application (e.g. { connectionId, store }).
 * It must always return a TernResult — throw or reject only on unexpected errors.
 */
export type HandlerFn = (request: TernRequest, ctx: HandlerContext) => Promise<TernResult>;

/** Host-application-specific context passed to every handler. */
export interface HandlerContext {
    readonly connectionId: string;
    readonly [key: string]: unknown;
}

interface LoadedEntry {
    readonly typeIri:  string;
    readonly priority: number;
    readonly moduleUrl: string;
    readonly exportName: string;
    handler?: HandlerFn;   // populated on first use
}

/**
 * Registry that maps TernTypeRef IRIs to one or more handler functions.
 *
 * Handlers are loaded lazily from their configured modules the first time a
 * matching request arrives.  Multiple handlers for the same type are tried in
 * ascending priority order; the first successful result short-circuits.
 */
export class HandlerRegistry implements Dispatcher {
    private readonly _entries = new Map<string, LoadedEntry[]>();
    private readonly _baseDir: string;

    constructor(baseDir: string = process.cwd()) {
        this._baseDir = baseDir;
    }

    // ── Registration ──────────────────────────────────────────────────────────

    /**
     * Register handlers from a flat list of HandlerEntries (e.g. from a merged
     * AppConfig).  Call this once after loading and merging all configs.
     */
    registerAll(entries: HandlerEntry[]): void {
        for (const e of entries) {
            this._add(e);
        }
    }

    /** Register a single inline handler function (useful for tests and defaults). */
    registerInline(typeRef: TernTypeRef, handler: HandlerFn, priority = 100): void {
        const typeIri = typeRef.iri;
        if (!this._entries.has(typeIri)) { this._entries.set(typeIri, []); }
        const entries = this._entries.get(typeIri)!;
        entries.push({ typeIri, priority, moduleUrl: '__inline__', exportName: '__inline__', handler });
        entries.sort((a, b) => a.priority - b.priority);
    }

    // ── Dispatch ──────────────────────────────────────────────────────────────

    /**
     * Dispatch a request to the highest-priority handler for its type IRI.
     * If no handler is registered, returns an error result.
     */
    async dispatch(request: TernRequest, ctx: HandlerContext): Promise<TernResult> {
        const entries = this._entries.get(request.type.iri);
        if (!entries || entries.length === 0) {
            return errResult(
                request.id,
                request.type,
                `No handler registered for "${request.type.iri}"`,
            );
        }

        for (const entry of entries) {
            const fn = await this._load(entry);
            try {
                const result = await fn(request, ctx);
                if (result.ok) { return result; }
            } catch (err) {
                // Log and try the next handler
                console.error(`[HandlerRegistry] Handler ${entry.moduleUrl}#${entry.exportName} threw:`, err);
            }
        }

        return errResult(request.id, request.type, 'All handlers failed or returned error results');
    }

    get registeredTypes(): string[] {
        return [...this._entries.keys()];
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private _add(e: HandlerEntry): void {
        const typeIri = e.typeIri;
        if (!this._entries.has(typeIri)) { this._entries.set(typeIri, []); }

        const moduleUrl  = this._resolveModuleUrl(e.module);
        const exportName = e.export ?? 'default';
        const priority   = e.priority ?? 100;

        const entries = this._entries.get(typeIri)!;
        entries.push({ typeIri, priority, moduleUrl, exportName });
        entries.sort((a, b) => a.priority - b.priority);
    }

    private _resolveModuleUrl(module: string): string {
        // Absolute URL or npm package — keep as-is
        if (module.startsWith('http://') || module.startsWith('https://') || module.startsWith('file://')) {
            return module;
        }
        // npm package (no leading ./  or ../)
        if (!module.startsWith('.')) { return module; }
        // Relative path — resolve against baseDir
        return pathToFileURL(resolve(this._baseDir, module)).href;
    }

    private async _load(entry: LoadedEntry): Promise<HandlerFn> {
        if (entry.handler) { return entry.handler; }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mod = await import(/* @vite-ignore */ entry.moduleUrl) as Record<string, any>;
        const fn  = mod[entry.exportName] as HandlerFn | undefined;

        if (typeof fn !== 'function') {
            throw new Error(`Module "${entry.moduleUrl}" has no export named "${entry.exportName}"`);
        }

        entry.handler = fn;
        return fn;
    }
}
