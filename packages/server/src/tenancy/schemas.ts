import {
    DomainIRI,
    domainDescriptionIRI,
    domainNameIRI,
    domainUrlIRI,
    hasDomainIRI,
    hasMemberIRI,
    hasOrgIRI,
    OrganizationIRI,
    orgNameIRI,
    orgOwnerIRI,
    orgTenantIRI,
    orgUserIRI,
    TenantIRI,
    tenantNameIRI,
    tenantUserIRI,
} from "@jasonscharf/core/tenancy";
import { EntitySchema } from "@jasonscharf/entities";
import { TENANCY_NS } from "./constants.js";

/**
 * The tenancy topology, modelled as an outward-from-root DAG so every domain
 * query can walk it root→leaf:
 *
 *   Tenant --hasOrg--> Org --hasMember--> User
 *   Tenant --hasDomain--> Domain
 *
 * Edges are real object-property edges (object is the target's IRI node), not
 * anyURI literals, so they can be joined/traversed. The `member` edge is
 * polymorphic (no target schema) to avoid a tenancy→auth import cycle — the leaf
 * schema (UserSchema) is supplied at the query terminal.
 *
 * The `users` collection properties (tenantUser / orgUser anyURI literals) carry
 * the legacy flat membership lists the repositories expose; they are distinct
 * from the traversable `member` containment edge and preserve the prior storage
 * shape. The `tenant` / `owner` edges replace the org's foreign-key scalars; they
 * are deliberately NOT containment edges, so they never widen a scope chain.
 */

export const DomainSchema = new EntitySchema({
    typeIRI: DomainIRI,
    ns: TENANCY_NS,
    idSegment: "domain",
    properties: {
        name: domainNameIRI,
        description: domainDescriptionIRI,
        url: domainUrlIRI,
    },
});

interface OrgProps extends Record<string, unknown> {
    name: string;
    users: string | string[];
}

export const OrgSchema: EntitySchema<OrgProps> = new EntitySchema<OrgProps>({
    typeIRI: OrganizationIRI,
    ns: TENANCY_NS,
    idSegment: "org",
    properties: {
        name: orgNameIRI,
        users: orgUserIRI,
    },
    edges: {
        member: {
            predicate: hasMemberIRI,
            cardinality: "many",
            direction: "out",
            containment: true,
        },
        tenant: {
            predicate: orgTenantIRI,
            target: () => TenantSchema,
            cardinality: "one",
            direction: "out",
        },
        owner: {
            predicate: orgOwnerIRI,
            cardinality: "one",
            direction: "out",
        },
    },
});

interface TenantProps extends Record<string, unknown> {
    name: string;
    users: string | string[];
}

export const TenantSchema: EntitySchema<TenantProps> = new EntitySchema<TenantProps>({
    typeIRI: TenantIRI,
    ns: TENANCY_NS,
    idSegment: "tenant",
    properties: {
        name: tenantNameIRI,
        users: tenantUserIRI,
    },
    edges: {
        org: {
            predicate: hasOrgIRI,
            target: () => OrgSchema,
            cardinality: "many",
            direction: "out",
            containment: true,
        },
        domain: {
            predicate: hasDomainIRI,
            target: () => DomainSchema,
            cardinality: "many",
            direction: "out",
            containment: true,
        },
    },
});
