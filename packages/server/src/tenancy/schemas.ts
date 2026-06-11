import {
    hasMemberIRI,
    hasOrgIRI,
    OrganizationIRI,
    orgNameIRI,
    TenantIRI,
    tenantNameIRI,
} from "@jasonscharf/core/tenancy";
import { EntitySchema } from "@jasonscharf/entities";
import { registerTopology } from "../topology.js";
import { TENANCY_NS } from "./constants.js";

/**
 * The tenancy topology, modelled as an outward-from-root DAG so every domain
 * query can walk it root→leaf:
 *
 *   Tenant --hasOrg--> Org --hasMember--> User
 *
 * Edges are real object-property edges (object is the target's IRI node), not
 * anyURI literals, so they can be joined/traversed. The `member` edge is
 * polymorphic (no target schema) to avoid a tenancy→auth import cycle — the leaf
 * schema (UserSchema) is supplied at the query terminal.
 */

export const OrgSchema = new EntitySchema({
    typeIRI: OrganizationIRI,
    ns: TENANCY_NS,
    idSegment: "org",
    properties: { name: orgNameIRI },
    edges: {
        member: { predicate: hasMemberIRI, cardinality: "many", direction: "out", containment: true },
    },
});

export const TenantSchema = new EntitySchema({
    typeIRI: TenantIRI,
    ns: TENANCY_NS,
    idSegment: "tenant",
    properties: { name: tenantNameIRI },
    edges: {
        org: {
            predicate: hasOrgIRI,
            target: () => OrgSchema,
            cardinality: "many",
            direction: "out",
            containment: true,
        },
    },
});

// Register the tenant→org→member containment edges so scope chains resolve over them.
registerTopology(TenantSchema, OrgSchema);
