import type { HandlerContext } from "@jasonscharf/app";
import {
    type BlankNode,
    errResult,
    type IRI,
    type Literal,
    okResult,
    TERN_TYPES,
    type TernRequest,
    type TernResult,
} from "@jasonscharf/core";
import { type QuadPattern, TripleStore } from "@jasonscharf/data";
import { buildServerContext } from "@jasonscharf/server";

type RdfTerm = IRI | BlankNode | Literal;

function makeIRI(value: string): IRI {
    return { value } as IRI;
}

function termFromWire(raw: unknown): RdfTerm | undefined {
    if (!raw || typeof raw !== "object") {
        return undefined;
    }
    const r = raw as Record<string, unknown>;
    if (typeof r.value === "string" && !("termType" in r)) {
        return makeIRI(r.value);
    }
    if (r.termType === "BlankNode" && typeof r.id === "string") {
        return { termType: "BlankNode", id: r.id };
    }
    if (r.termType === "Literal" && typeof r.value === "string") {
        return {
            termType: "Literal",
            value: r.value as string,
            datatype: makeIRI(
                typeof r.datatype === "string"
                    ? r.datatype
                    : "http://www.w3.org/2001/XMLSchema#string",
            ),
            language: typeof r.lang === "string" ? r.lang : undefined,
        };
    }
    return undefined;
}

function patternFromWire(raw: unknown): QuadPattern {
    if (!raw || typeof raw !== "object") {
        return {};
    }
    const r = raw as Record<string, unknown>;
    return {
        subject: termFromWire(r.subject) as IRI | BlankNode | undefined,
        predicate: termFromWire(r.predicate) as IRI | undefined,
        object: termFromWire(r.object) as RdfTerm | undefined,
        graph: termFromWire(r.graph) as IRI | undefined,
    };
}

function getStore(ctx: HandlerContext): TripleStore {
    const store = ctx.store;
    if (!(store instanceof TripleStore)) {
        throw new Error("HandlerContext.store must be a TripleStore instance");
    }
    return store;
}

export async function handleFind(request: TernRequest, ctx: HandlerContext): Promise<TernResult> {
    const store = getStore(ctx);
    const pattern = patternFromWire(request.payload);
    const quads = await store.find(buildServerContext(store), pattern);
    return okResult(request.id, TERN_TYPES.tripleFind, { quads });
}

export async function handleInsert(request: TernRequest, ctx: HandlerContext): Promise<TernResult> {
    const store = getStore(ctx);
    const payload = request.payload as Record<string, unknown> | undefined;
    if (!payload) {
        return errResult(request.id, TERN_TYPES.tripleInsert, "Missing payload");
    }
    const subject = termFromWire(payload.subject);
    if (subject == null) {
        return errResult(request.id, TERN_TYPES.tripleInsert, "Missing or invalid subject");
    }
    const predicate = termFromWire(payload.predicate);
    if (predicate == null) {
        return errResult(request.id, TERN_TYPES.tripleInsert, "Missing or invalid predicate");
    }
    const object = termFromWire(payload.object);
    if (object == null) {
        return errResult(request.id, TERN_TYPES.tripleInsert, "Missing or invalid object");
    }
    await store.insert(buildServerContext(store), {
        subject: subject as IRI | BlankNode,
        predicate: predicate as IRI,
        object: object as RdfTerm,
        graph: (termFromWire(payload.graph) as IRI | undefined) ?? makeIRI(""),
    });
    return okResult(request.id, TERN_TYPES.tripleInsert);
}

export async function handleStats(request: TernRequest, ctx: HandlerContext): Promise<TernResult> {
    const store = getStore(ctx);
    const stats = await store.stats(buildServerContext(store));
    return okResult(request.id, TERN_TYPES.tripleStats, stats);
}
