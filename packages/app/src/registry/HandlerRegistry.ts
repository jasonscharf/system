import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
    anonymousSec,
    errResult,
    getLogger,
    resolveModuleRef,
    type SecurityContext,
    type SystemRequest,
    type SystemResult,
    type SystemTypeRef,
} from "@jasonscharf/core";
import type { HandlerEntry } from "../config/types.js";
import type { Dispatcher } from "../routing/Dispatcher.js";

const log = getLogger("HandlerRegistry");

/**
 * The contract every handler function must satisfy.
 *
 * A handler receives the inbound SystemRequest plus an opaque context object
 * whose shape is defined by the host application (e.g. { connectionId, store }).
 * It must always return a SystemResult — throw or reject only on unexpected errors.
 */
export type HandlerFn = (request: SystemRequest, ctx: HandlerContext) => Promise<SystemResult>;

/**
 * Host-application-specific context passed to every handler.
 *
 * `sec` is always present: the dispatch entry point normalizes an omitted
 * principal to `anonymousSec`, so a handler can read `ctx.sec` unconditionally
 * and must fail closed when it is anonymous but a real principal is required.
 * `tenantId` scopes the request, or is null for cross-tenant / system calls.
 */
export interface HandlerContext {
    readonly connectionId: string;
    readonly sec: SecurityContext;
    readonly tenantId: string | null;
    readonly [key: string]: unknown;
}

/**
 * The loosened context accepted by `dispatch()`.  Callers may omit `sec` and
 * `tenantId`; the registry fills the safe anonymous defaults before handing a
 * fully-populated {@link HandlerContext} to each handler.
 */
export interface HandlerContextInput {
    readonly connectionId: string;
    readonly sec?: SecurityContext;
    readonly tenantId?: string | null;
    readonly [key: string]: unknown;
}

interface LoadedEntry {
    readonly typeIri: string;
    readonly priority: number;
    /**
     * When `refUri` is set, the handler is resolved via `resolveModuleRef`.
     * When absent, the legacy `moduleUrl` + `exportName` path is used.
     */
    readonly refUri: string | undefined;
    readonly moduleUrl: string;
    readonly exportName: string;
    handler?: HandlerFn; // populated on first use
}

/**
 * Registry that maps SystemTypeRef IRIs to one or more handler functions.
 *
 * Handlers are loaded lazily from their configured modules the first time a
 * matching request arrives.  Multiple handlers for the same type are tried in
 * ascending priority order; the first successful result short-circuits.
 *
 * Handlers may be registered in two ways:
 *
 *   - **Split fields** (`module` + optional `export`): the original format,
 *     fully supported and unchanged.
 *   - **Unified `ref`**: a `module://` URI resolved by `resolveModuleRef`.
 *     When `ref` is present on a `HandlerEntry`, the split fields are ignored.
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
    registerInline(typeRef: SystemTypeRef, handler: HandlerFn, priority = 100): void {
        const typeIri = typeRef.iri;
        if (!this._entries.has(typeIri)) {
            this._entries.set(typeIri, []);
        }
        const entries = this._entries.get(typeIri);
        if (entries == null) {
            throw new Error(`HandlerRegistry: missing entries for typeIri "${typeIri}"`);
        }
        entries.push({
            typeIri,
            priority,
            refUri: undefined,
            moduleUrl: "__inline__",
            exportName: "__inline__",
            handler,
        });
        entries.sort((a, b) => a.priority - b.priority);
    }

    // ── Dispatch ──────────────────────────────────────────────────────────────

    /**
     * Dispatch a request to the highest-priority handler for its type IRI.
     * If no handler is registered, returns an error result.
     */
    async dispatch(request: SystemRequest, ctx: HandlerContextInput): Promise<SystemResult> {
        const entries = this._entries.get(request.type.iri);
        if (!entries || entries.length === 0) {
            return errResult(
                request.id,
                request.type,
                `No handler registered for "${request.type.iri}"`,
            );
        }

        // Normalize the loosened input into a fully-populated context so every
        // handler reads a guaranteed `sec` (anonymous by default) and `tenantId`.
        const fullCtx: HandlerContext = {
            ...ctx,
            sec: ctx.sec ?? anonymousSec,
            tenantId: ctx.tenantId ?? null,
        };

        for (const entry of entries) {
            try {
                const fn = await this._load(entry);
                const result = await fn(request, fullCtx);
                if (result.ok) {
                    return result;
                }
            } catch (err) {
                // Log the failure and try the next registered handler
                log.error("handler threw, trying the next one", {
                    moduleUrl: entry.moduleUrl,
                    exportName: entry.exportName,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }

        return errResult(request.id, request.type, "All handlers failed or returned error results");
    }

    get registeredTypes(): string[] {
        return [...this._entries.keys()];
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private _add(e: HandlerEntry): void {
        const typeIri = e.typeIri;
        if (!this._entries.has(typeIri)) {
            this._entries.set(typeIri, []);
        }

        const priority = e.priority ?? 100;
        const entries = this._entries.get(typeIri);
        if (entries == null) {
            throw new Error(`HandlerRegistry: missing entries for typeIri "${typeIri}"`);
        }

        if (e.ref != null) {
            // Unified module:// ref path — module/export fields are ignored.
            entries.push({
                typeIri,
                priority,
                refUri: e.ref,
                moduleUrl: e.ref,
                exportName: "__ref__",
            });
        } else {
            // Legacy split-fields path — backward-compatible.
            const moduleUrl = this._resolveModuleUrl(e.module ?? "");
            const exportName = e.export ?? "default";
            entries.push({ typeIri, priority, refUri: undefined, moduleUrl, exportName });
        }

        entries.sort((a, b) => a.priority - b.priority);
    }

    private _resolveModuleUrl(module: string): string {
        // Absolute URL or npm package — keep as-is
        if (
            module.startsWith("http://") ||
            module.startsWith("https://") ||
            module.startsWith("file://")
        ) {
            return module;
        }
        // npm package (no leading ./  or ../)
        if (!module.startsWith(".")) {
            return module;
        }
        // Relative path — resolve against baseDir
        return pathToFileURL(resolve(this._baseDir, module)).href;
    }

    private async _load(entry: LoadedEntry): Promise<HandlerFn> {
        if (entry.handler) {
            return entry.handler;
        }

        if (entry.refUri != null) {
            const { fn } = await resolveModuleRef(entry.refUri, this._baseDir);
            const handlerFn = fn as HandlerFn;
            entry.handler = handlerFn;
            return handlerFn;
        }

        const mod = (await import(/* @vite-ignore */ entry.moduleUrl)) as Record<string, unknown>;
        const fn = mod[entry.exportName] as HandlerFn | undefined;

        if (typeof fn !== "function") {
            throw new Error(
                `Module "${entry.moduleUrl}" has no export named "${entry.exportName}"`,
            );
        }

        entry.handler = fn;
        return fn;
    }
}
