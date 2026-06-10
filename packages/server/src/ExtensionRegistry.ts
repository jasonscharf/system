import { DEFAULT_GRAPH, IRI, makeUri, NS_ROOT } from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import { toLiteral } from "@jasonscharf/entities";
import type { ServerContext } from "./ServerContext.js";

// ── Ontology constants ────────────────────────────────────────────────────────

const NS = makeUri(NS_ROOT, "app");
const EXT_NS = makeUri(NS, "ext");

const EXT_TYPE = new IRI(makeUri(NS, "InstalledExtension"));
const RDF_TYPE = new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const PRED_NAME = new IRI(makeUri(NS, "extName"));
const PRED_VERSION = new IRI(makeUri(NS, "extVersion"));
const PRED_INSTALLED_AT = new IRI(makeUri(NS, "installedAt"));

function _extIri(name: string): IRI {
    return new IRI(makeUri(EXT_NS, encodeURIComponent(name)));
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExtensionRecord {
    readonly name: string;
    readonly version: string;
    readonly installedAt: string;
}

// ── ExtensionRegistry ─────────────────────────────────────────────────────────

/**
 * Persists extension install records as quads in the triple store.
 *
 * Each installed extension is represented as:
 *   urn:sys:app:ext:{name}  a  urn:sys:app:InstalledExtension ;
 *     urn:sys:app:extName      "{name}" ;
 *     urn:sys:app:extVersion   "{version}" ;
 *     urn:sys:app:installedAt  "{iso-timestamp}" .
 */
export class ExtensionRegistry {
    constructor(private readonly _store: TripleStore) {}

    async isInstalled(ctx: ServerContext, name: string): Promise<boolean> {
        const iri = _extIri(name);
        const rows = await this._store.find(ctx, { subject: iri, predicate: PRED_NAME });
        return rows.length > 0;
    }

    async getVersion(ctx: ServerContext, name: string): Promise<string | null> {
        const iri = _extIri(name);
        const rows = await this._store.find(ctx, { subject: iri, predicate: PRED_VERSION });
        if (rows.length === 0) {
            return null;
        }
        const obj = rows[0]?.object;
        if (obj && typeof obj === "object" && "value" in obj) {
            return String(obj.value);
        }
        return null;
    }

    async record(ctx: ServerContext, name: string, version: string): Promise<void> {
        const iri = _extIri(name);
        await this._store.withTransaction(ctx, async (txCtx) => {
            await this._store.deleteBySubjectPredicates(txCtx, iri, [
                PRED_VERSION,
                PRED_INSTALLED_AT,
            ]);
            await this._store.insertMany(txCtx, [
                { subject: iri, predicate: RDF_TYPE, object: EXT_TYPE, graph: DEFAULT_GRAPH },
                {
                    subject: iri,
                    predicate: PRED_NAME,
                    object: toLiteral(name),
                    graph: DEFAULT_GRAPH,
                },
                {
                    subject: iri,
                    predicate: PRED_VERSION,
                    object: toLiteral(version),
                    graph: DEFAULT_GRAPH,
                },
                {
                    subject: iri,
                    predicate: PRED_INSTALLED_AT,
                    object: toLiteral(new Date().toISOString()),
                    graph: DEFAULT_GRAPH,
                },
            ]);
        });
    }

    async remove(ctx: ServerContext, name: string): Promise<void> {
        const iri = _extIri(name);
        await this._store.delete(ctx, { subject: iri });
    }

    async list(ctx: ServerContext): Promise<ExtensionRecord[]> {
        return this._store.withTransaction(ctx, async (txCtx) => {
            const rows = await this._store.find(txCtx, { predicate: RDF_TYPE, object: EXT_TYPE });
            const subjects = [...new Set(rows.map((r) => (r.subject as IRI).value))];

            const results: ExtensionRecord[] = [];
            for (const subjectIri of subjects) {
                const subj = new IRI(subjectIri);
                const quads = await this._store.find(txCtx, { subject: subj });
                const map: Record<string, string> = {};
                for (const q of quads) {
                    const pred = (q.predicate as IRI).value;
                    const obj = q.object;
                    if (obj && typeof obj === "object" && "value" in obj) {
                        map[pred] = String(obj.value);
                    }
                }
                const name = map[PRED_NAME.value];
                const version = map[PRED_VERSION.value];
                const installedAt = map[PRED_INSTALLED_AT.value] ?? "";
                if (name && version) {
                    results.push({ name, version, installedAt });
                }
            }
            return results;
        });
    }
}
