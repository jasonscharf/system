import type { HandlerContext } from "@jasonscharf/app";
import {
    type BlankNode,
    errResult,
    type IRI,
    type Literal,
    okResult,
    SYSTEM_TYPES,
    type SystemRequest,
    type SystemResult,
    type SystemTypeRef,
} from "@jasonscharf/core";
import { type QuadPattern, TripleStore } from "@jasonscharf/data";
import { buildServerContext, RbacService, SuperuserService, systemSec } from "@jasonscharf/server";

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

/**
 * The triple.* handlers are raw, graph-wide store access — reading any graph and
 * forging quads (including RBAC grants). They are gated behind superuser
 * membership (TRN-527). Returns an error SystemResult to deny, or null to allow.
 *
 * Fails closed: an anonymous principal, or a context wired without an RbacService
 * (so superuser cannot be evaluated), is denied.
 */
async function denyUnlessSuperuser(
    request: SystemRequest,
    ctx: HandlerContext,
    type: SystemTypeRef,
): Promise<SystemResult | null> {
    const sec = ctx.sec;
    const rbac = ctx.rbac;
    if (sec.principalIri === null || !(rbac instanceof RbacService)) {
        return errResult(
            request.id,
            type,
            "Access denied: triple.* requires an authenticated superuser",
        );
    }
    // Membership evaluation is a system-level authorization read: listMembers is
    // itself admin-gated, so it must run as the internal system principal (the
    // same bootstrap pattern AuthService.validateToken uses), not the caller's
    // sec — which would throw for exactly the non-superusers we mean to deny. The
    // caller never sees the membership; we only branch on the boolean.
    const isSuper = await new SuperuserService(rbac).isSuperuser(
        buildServerContext(getStore(ctx)),
        systemSec,
        { userIri: sec.principalIri },
    );
    if (!isSuper) {
        return errResult(request.id, type, "Access denied: triple.* requires superuser");
    }
    return null;
}

export async function handleFind(
    request: SystemRequest,
    ctx: HandlerContext,
): Promise<SystemResult> {
    const denied = await denyUnlessSuperuser(request, ctx, SYSTEM_TYPES.tripleFind);
    if (denied !== null) {
        return denied;
    }
    const store = getStore(ctx);
    const pattern = patternFromWire(request.payload);
    const quads = await store.find(buildServerContext(store), pattern);
    return okResult(request.id, SYSTEM_TYPES.tripleFind, { quads });
}

export async function handleInsert(
    request: SystemRequest,
    ctx: HandlerContext,
): Promise<SystemResult> {
    const denied = await denyUnlessSuperuser(request, ctx, SYSTEM_TYPES.tripleInsert);
    if (denied !== null) {
        return denied;
    }
    const store = getStore(ctx);
    const payload = request.payload as Record<string, unknown> | undefined;
    if (!payload) {
        return errResult(request.id, SYSTEM_TYPES.tripleInsert, "Missing payload");
    }
    const subject = termFromWire(payload.subject);
    if (subject == null) {
        return errResult(request.id, SYSTEM_TYPES.tripleInsert, "Missing or invalid subject");
    }
    const predicate = termFromWire(payload.predicate);
    if (predicate == null) {
        return errResult(request.id, SYSTEM_TYPES.tripleInsert, "Missing or invalid predicate");
    }
    const object = termFromWire(payload.object);
    if (object == null) {
        return errResult(request.id, SYSTEM_TYPES.tripleInsert, "Missing or invalid object");
    }
    await store.insert(buildServerContext(store), {
        subject: subject as IRI | BlankNode,
        predicate: predicate as IRI,
        object: object as RdfTerm,
        graph: (termFromWire(payload.graph) as IRI | undefined) ?? makeIRI(""),
    });
    return okResult(request.id, SYSTEM_TYPES.tripleInsert);
}

export async function handleStats(
    request: SystemRequest,
    ctx: HandlerContext,
): Promise<SystemResult> {
    const denied = await denyUnlessSuperuser(request, ctx, SYSTEM_TYPES.tripleStats);
    if (denied !== null) {
        return denied;
    }
    const store = getStore(ctx);
    const stats = await store.stats(buildServerContext(store));
    return okResult(request.id, SYSTEM_TYPES.tripleStats, stats);
}
