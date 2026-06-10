import { randomBytes } from "node:crypto";
import { IRI, literal, makeUri, type Quad } from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { SecurityContext } from "../SecurityContext.js";
import type { ServerContext } from "../ServerContext.js";
import {
    AUDIT_GRAPH,
    AUDIT_NS,
    AuditEventIRI,
    auditActingAsIRI,
    auditActionIRI,
    auditActorIRI,
    auditAtIRI,
    auditTargetIRI,
    RDF_TYPE,
    XSD_ANY_URI,
    XSD_DATETIME,
    XSD_STRING,
} from "./constants.js";

export interface RecordAuditArgs {
    /** Short verb for the action, e.g. "impersonation.start". */
    action: string;
    /** IRI (or id) of the entity the action targeted, when applicable. */
    target?: string;
    /** The real principal that acted. Recorded as the actor even while impersonating. */
    actor?: string;
    /** The effective principal the request operated as, present only when impersonating. */
    actingAs?: string;
}

export interface ListAuditArgs {
    /** Cap the number of (most recent first) entries returned. */
    limit?: number;
}

export interface AuditEntry {
    id: string;
    iri: string;
    actor: string | undefined;
    actingAs: string | undefined;
    action: string;
    target: string | undefined;
    at: Date;
}

/**
 * Append-only audit trail of sensitive actions. The real caller is recorded as
 * the actor (even while impersonating), so the trail answers "who really did
 * this" rather than "who did the request appear to come from". Attribution
 * (actor/actingAs) is supplied explicitly by the caller — the trail makes no
 * assumptions about how a host application carries its request principal.
 */
export class AuditRepository {
    private readonly _store: TripleStore;

    constructor(store: TripleStore) {
        this._store = store;
    }

    /** @insecure @nochecks */
    async record(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: RecordAuditArgs,
    ): Promise<AuditEntry> {
        const id = randomBytes(16).toString("hex");
        const subject = new IRI(makeUri(AUDIT_NS, "event", id));
        const at = new Date();

        const quads: Quad[] = [
            { subject, predicate: RDF_TYPE, object: AuditEventIRI, graph: AUDIT_GRAPH },
            {
                subject,
                predicate: auditActionIRI,
                object: literal(args.action, XSD_STRING),
                graph: AUDIT_GRAPH,
            },
            {
                subject,
                predicate: auditAtIRI,
                object: literal(at.toISOString(), XSD_DATETIME),
                graph: AUDIT_GRAPH,
            },
        ];
        if (args.actor !== undefined) {
            quads.push({
                subject,
                predicate: auditActorIRI,
                object: literal(args.actor, XSD_ANY_URI),
                graph: AUDIT_GRAPH,
            });
        }
        if (args.actingAs !== undefined) {
            quads.push({
                subject,
                predicate: auditActingAsIRI,
                object: literal(args.actingAs, XSD_ANY_URI),
                graph: AUDIT_GRAPH,
            });
        }
        if (args.target !== undefined) {
            quads.push({
                subject,
                predicate: auditTargetIRI,
                object: literal(args.target, XSD_ANY_URI),
                graph: AUDIT_GRAPH,
            });
        }

        await this._store.insertMany(ctx, quads);

        return {
            id,
            iri: subject.value,
            actor: args.actor,
            actingAs: args.actingAs,
            action: args.action,
            target: args.target,
            at,
        };
    }

    /** @insecure @nochecks */
    async list(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: ListAuditArgs = {},
    ): Promise<AuditEntry[]> {
        const typeQuads = await this._store.find(ctx, {
            predicate: RDF_TYPE,
            object: AuditEventIRI,
            graph: AUDIT_GRAPH,
        });
        const subjects = typeQuads.map((q) => q.subject as IRI);
        if (subjects.length === 0) {
            return [];
        }

        // One batched read for every event's fields (no per-event round-trip).
        const bySubject = await this._store.findForSubjects(ctx, subjects, AUDIT_GRAPH);
        const entries = subjects.map((subject) => {
            const quads = bySubject.get(subject.value) ?? [];
            const get = (pred: IRI): string | undefined => {
                const q = quads.find((qq) => (qq.predicate as IRI).value === pred.value);
                return q !== undefined ? String((q.object as { value: string }).value) : undefined;
            };
            const atStr = get(auditAtIRI);
            return {
                id: subject.value.match(/[^:/#]+$/)?.[0] ?? subject.value,
                iri: subject.value,
                actor: get(auditActorIRI),
                actingAs: get(auditActingAsIRI),
                action: get(auditActionIRI) ?? "",
                target: get(auditTargetIRI),
                at: atStr !== undefined ? new Date(atStr) : new Date(0),
            };
        });

        entries.sort((a, b) => b.at.getTime() - a.at.getTime());
        const limit = args.limit ?? entries.length;
        return entries.slice(0, limit);
    }
}
