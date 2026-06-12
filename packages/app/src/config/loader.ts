import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseTurtle } from "./parseTurtle.js";
import { parseYaml, type YamlValue } from "./parseYaml.js";
import type { AppConfig, ExtensionConfig, HandlerEntry } from "./types.js";

// ── YAML ──────────────────────────────────────────────────────────────────────

function handlerEntryFromYaml(raw: unknown): HandlerEntry {
    if (!raw || typeof raw !== "object") {
        throw new Error("Invalid handler entry");
    }
    const r = raw as Record<string, unknown>;
    return {
        typeIri: String(r.type ?? r.typeIri ?? ""),
        ref: r.ref ? String(r.ref) : undefined,
        module: String(r.module ?? ""),
        export: r.export ? String(r.export) : undefined,
        priority: r.priority ? Number(r.priority) : undefined,
    };
}

function extensionConfigFromYaml(raw: YamlValue): ExtensionConfig {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("Extension config must be a YAML mapping");
    }
    const r = raw as Record<string, unknown>;
    const handlers = Array.isArray(r.handlers)
        ? (r.handlers as unknown[]).map(handlerEntryFromYaml)
        : [];
    return {
        name: String(r.name ?? "unnamed"),
        version: r.version ? String(r.version) : undefined,
        description: r.description ? String(r.description) : undefined,
        handlers,
    };
}

function appConfigFromYaml(
    raw: YamlValue,
): Omit<AppConfig, "handlers"> & { handlers: HandlerEntry[] } {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("App config must be a YAML mapping");
    }
    const r = raw as Record<string, unknown>;
    const handlers = Array.isArray(r.handlers)
        ? (r.handlers as unknown[]).map(handlerEntryFromYaml)
        : [];
    const extensions = Array.isArray(r.extensions) ? (r.extensions as unknown[]).map(String) : [];
    return {
        name: String(r.name ?? "unnamed"),
        version: r.version ? String(r.version) : undefined,
        description: r.description ? String(r.description) : undefined,
        author: r.author ? String(r.author) : undefined,
        license: r.license ? String(r.license) : undefined,
        ternVersion: r.ternVersion ? String(r.ternVersion) : undefined,
        extensions,
        handlers,
    };
}

// ── Turtle / RDF ──────────────────────────────────────────────────────────────

const NS = {
    type: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
    ext: "urn:sys:core:app:Extension",
    name: "urn:sys:core:app:name",
    version: "urn:sys:core:app:version",
    desc: "urn:sys:core:app:description",
    handler: "urn:sys:core:app:handler",
    hType: "urn:sys:core:app:type",
    hRef: "urn:sys:core:app:ref",
    hModule: "urn:sys:core:app:module",
    hExport: "urn:sys:core:app:export",
    hPriority: "urn:sys:core:app:priority",
} as const;

function extensionConfigFromTurtle(turtle: string): ExtensionConfig {
    const triples = parseTurtle(turtle);

    // Find the Extension subject
    const extSubject = triples.find((t) => t.p === NS.type && t.o === NS.ext)?.s;
    if (!extSubject) {
        throw new Error("No Extension found in Turtle config");
    }

    // Index all triples by subject
    const bySubject = new Map<string, typeof triples>();
    for (const t of triples) {
        if (!bySubject.has(t.s)) {
            bySubject.set(t.s, []);
        }
        bySubject.get(t.s)?.push(t);
    }

    const extTriples = bySubject.get(extSubject) ?? [];
    const get = (p: string) => extTriples.find((t) => t.p === p)?.o;

    const handlerBnodeIds = extTriples.filter((t) => t.p === NS.handler).map((t) => t.o);

    const handlers: HandlerEntry[] = handlerBnodeIds.map((bnodeId) => {
        const hTriples = bySubject.get(bnodeId) ?? [];
        const hGet = (p: string) => hTriples.find((t) => t.p === p)?.o;
        return {
            typeIri: hGet(NS.hType) ?? "",
            ref: hGet(NS.hRef),
            module: hGet(NS.hModule) ?? "",
            export: hGet(NS.hExport),
            priority: hGet(NS.hPriority) ? Number(hGet(NS.hPriority)) : undefined,
        };
    });

    return {
        name: get(NS.name) ?? "unnamed",
        version: get(NS.version),
        description: get(NS.desc),
        handlers,
    };
}

// ── Loader ────────────────────────────────────────────────────────────────────

async function loadExtensionConfig(path: string): Promise<ExtensionConfig> {
    const text = await readFile(path, "utf8");
    const ext = path.toLowerCase();

    if (ext.endsWith(".yaml") || ext.endsWith(".yml")) {
        return extensionConfigFromYaml(parseYaml(text));
    }
    if (ext.endsWith(".ttl") || ext.endsWith(".turtle") || ext.endsWith(".nt")) {
        return extensionConfigFromTurtle(text);
    }
    throw new Error(`Unsupported extension config format: ${path}`);
}

/**
 * Merges an array of ExtensionConfigs and user-level handlers into a single
 * flat array of HandlerEntries, sorted by priority ascending (lower = first).
 *
 * Merging strategy:
 *   - Extensions are processed in order; later extensions for the same type
 *     IRI shadow earlier ones when priority values are equal.
 *   - User-level `userHandlers` are always applied last (treated as priority 0
 *     unless they specify their own).
 */
export function mergeHandlers(
    extensions: ExtensionConfig[],
    userHandlers: HandlerEntry[],
): HandlerEntry[] {
    const all: HandlerEntry[] = [
        ...extensions.flatMap((e) => e.handlers),
        ...userHandlers.map((h) => ({ ...h, priority: h.priority ?? 0 })),
    ];
    return all.slice().sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
}

/**
 * Load an application config from a YAML file.
 * All referenced extension configs are loaded and merged automatically.
 */
export async function loadAppConfig(appConfigPath: string): Promise<{
    config: AppConfig;
    resolvedHandlers: HandlerEntry[];
}> {
    const text = await readFile(appConfigPath, "utf8");
    const raw = appConfigFromYaml(parseYaml(text));
    const baseDir = dirname(resolve(appConfigPath));

    const extensions: ExtensionConfig[] = await Promise.all(
        raw.extensions.map((relPath) => loadExtensionConfig(resolve(baseDir, relPath))),
    );

    const config: AppConfig = { ...raw };
    const resolvedHandlers = mergeHandlers(extensions, raw.handlers);

    return { config, resolvedHandlers };
}
