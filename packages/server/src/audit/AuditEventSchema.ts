import { EntitySchema } from "@jasonscharf/entities";
import {
    AUDIT_GRAPH,
    AUDIT_NS,
    AuditEventIRI,
    auditActingAsIRI,
    auditActionIRI,
    auditActorIRI,
    auditAtIRI,
    auditTargetIRI,
} from "./constants.js";

/**
 * Typed schema for an audit event.
 *
 * graphIri is pinned to AUDIT_GRAPH on purpose: the trail is a system-level
 * global backbone, NOT tenant-scoped data, so a single trail records sensitive
 * cross-tenant actions (e.g. a superuser impersonating a user in another tenant)
 * with the real actor.  This is the documented use of graphIri (see EntitySchema)
 * and is distinct from the TRN-215 case, where tenant-domain entities were wrongly
 * pinned and lost rooted-traversal reachability.  Audit has no rooted traversal:
 * it is addressed only by its own type, never reached through a tenant.
 *
 * `at` is carried as an explicit dateTime property (not sourced from the node's
 * created_at column) to preserve the prior ordering semantics exactly.
 */
export const AuditEventSchema = new EntitySchema({
    typeIRI: AuditEventIRI,
    ns: AUDIT_NS,
    idSegment: "event",
    graphIri: AUDIT_GRAPH,
    properties: {
        action: auditActionIRI,
        actor: auditActorIRI,
        actingAs: auditActingAsIRI,
        target: auditTargetIRI,
        at: auditAtIRI,
    },
});
