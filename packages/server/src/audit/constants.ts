import { IRI, makeUri, NS_CORE } from "@jasonscharf/core";

// Audit lives in its own system-level named graph. It is intentionally NOT
// tenant-scoped: a single trail records sensitive cross-tenant actions (e.g. a
// superuser impersonating a user in another tenant) with the real actor.
export const AUDIT_NS = makeUri(NS_CORE, "audit");
export const AUDIT_GRAPH = new IRI(makeUri(AUDIT_NS, "graph"));

export const AuditEventIRI = new IRI(makeUri(AUDIT_NS, "Event"));

/** The real authenticated caller, recorded even while impersonating. */
export const auditActorIRI = new IRI(makeUri(AUDIT_NS, "actor"));
/** The principal the request operated as, present only when impersonating. */
export const auditActingAsIRI = new IRI(makeUri(AUDIT_NS, "actingAs"));
/** A short verb describing the action, e.g. "impersonation.start". */
export const auditActionIRI = new IRI(makeUri(AUDIT_NS, "action"));
/** The entity the action targeted, when applicable. */
export const auditTargetIRI = new IRI(makeUri(AUDIT_NS, "target"));
/** ISO-8601 timestamp the action was recorded. */
export const auditAtIRI = new IRI(makeUri(AUDIT_NS, "at"));
