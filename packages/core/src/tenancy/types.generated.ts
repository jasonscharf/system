// auto-generated — do not edit by hand
import { IRI } from "../semantics/IRI.js";

export const TENANCY_NS = "urn:sys:core:tenancy:";
export const TENANCY_GRAPH = new IRI(`${TENANCY_NS}graph`);

/** A customer organisation — the licensee of the platform. */
export interface Tenant {
    tenantName?: string;
}

export const TenantIRI = new IRI(`${TENANCY_NS}Tenant`);

/** A user-facing named group that wraps a backing Tenant. */
export interface Organization {
    orgName?: string;
}

export const OrganizationIRI = new IRI(`${TENANCY_NS}Organization`);

/** A registered domain (e.g. example.com) belonging to a Tenant. */
export interface Domain {
    domainName?: string;
    domainDescription?: string;
    domainUrl?: string;
}

export const DomainIRI = new IRI(`${TENANCY_NS}Domain`);

// Outward-from-root topology edges (object-property: object is the target IRI node).
export const hasOrgIRI = new IRI(`${TENANCY_NS}hasOrg`);
export const hasMemberIRI = new IRI(`${TENANCY_NS}hasMember`);

export const tenantNameIRI = new IRI(`${TENANCY_NS}tenantName`);
export const tenantUserIRI = new IRI(`${TENANCY_NS}tenantUser`);

export const orgNameIRI = new IRI(`${TENANCY_NS}orgName`);
export const orgTenantIRI = new IRI(`${TENANCY_NS}orgTenant`);
export const orgUserIRI = new IRI(`${TENANCY_NS}orgUser`);
export const orgOwnerIRI = new IRI(`${TENANCY_NS}orgOwner`);

export const domainNameIRI = new IRI(`${TENANCY_NS}domainName`);
export const domainDescriptionIRI = new IRI(`${TENANCY_NS}domainDescription`);
export const domainUrlIRI = new IRI(`${TENANCY_NS}domainUrl`);
export const domainTenantIRI = new IRI(`${TENANCY_NS}domainTenant`);
