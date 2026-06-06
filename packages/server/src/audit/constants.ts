import { IRI, NS_ROOT } from "@jasonscharf/core";

// Audit lives in its own system-level named graph. It is intentionally NOT
// tenant-scoped: a single trail records sensitive cross-tenant actions (e.g. a
// superuser impersonating a user in another tenant) with the real actor.
export const AUDIT_NS = `${NS_ROOT}audit:`;
export const AUDIT_GRAPH = new IRI(`${AUDIT_NS}graph`);

export const AuditEventIRI = new IRI(`${AUDIT_NS}Event`);

/** The real authenticated caller, recorded even while impersonating. */
export const auditActorIRI = new IRI(`${AUDIT_NS}actor`);
/** The principal the request operated as, present only when impersonating. */
export const auditActingAsIRI = new IRI(`${AUDIT_NS}actingAs`);
/** A short verb describing the action, e.g. "impersonation.start". */
export const auditActionIRI = new IRI(`${AUDIT_NS}action`);
/** The entity the action targeted, when applicable. */
export const auditTargetIRI = new IRI(`${AUDIT_NS}target`);
/** ISO-8601 timestamp the action was recorded. */
export const auditAtIRI = new IRI(`${AUDIT_NS}at`);

export const RDF_TYPE = new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const XSD_NS = "http://www.w3.org/2001/XMLSchema#";
export const XSD_STRING = new IRI(`${XSD_NS}string`);
export const XSD_DATETIME = new IRI(`${XSD_NS}dateTime`);
export const XSD_ANY_URI = new IRI(`${XSD_NS}anyURI`);
