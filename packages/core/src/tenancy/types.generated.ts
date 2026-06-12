// auto-generated — do not edit by hand

import type { User } from "../auth/types.generated.js";
import type { License } from "../licensing/types.generated.js";
import { IRI } from "../semantics/IRI.js";

/** A customer organisation — the licensee of the platform. */
export interface Tenant {
    /** Outward edge: a Tenant contains an Organization (root→down). */
    hasOrg?: Organization[];
    /** Outward edge: a Tenant owns a registered Domain (tenant→domain). */
    hasDomain?: Domain[];
    /** Outward edge: a Tenant holds a License (root→down). */
    hasLicense?: License[];
    /** Display name of the tenant organisation. */
    tenantName?: string;
    /** IRI of a member auth:User; one triple per member. */
    tenantUser?: string;
}

export const TenantIRI = new IRI("urn:sys:core:tenancy:Tenant");

/** A user-facing named group that wraps a backing Tenant. */
export interface Organization {
    /** Outward edge: an Organization contains a member User (org→user). */
    hasMember?: User[];
    /** Display name of the organization (user-renameable). */
    orgName?: string;
    /** IRI of the Tenant that backs this Organization. */
    orgTenant?: string;
    /** IRI of a member auth:User; one triple per member. */
    orgUser?: string;
    /** IRI of the founding auth:User who created the organization. */
    orgOwner?: string;
}

export const OrganizationIRI = new IRI("urn:sys:core:tenancy:Organization");

/** A registered domain (e.g. example.com) belonging to a Tenant. */
export interface Domain {
    /** The domain name, e.g. 'example.com'. */
    domainName?: string;
    /** Human-readable description of the domain. */
    domainDescription?: string;
    /** The canonical URL of the domain. */
    domainUrl?: string;
    /** The Tenant this domain belongs to. */
    domainTenant?: Tenant[];
}

export const DomainIRI = new IRI("urn:sys:core:tenancy:Domain");

export const hasOrgIRI = new IRI("urn:sys:core:tenancy:hasOrg");
export const hasMemberIRI = new IRI("urn:sys:core:tenancy:hasMember");
export const hasDomainIRI = new IRI("urn:sys:core:tenancy:hasDomain");
export const hasLicenseIRI = new IRI("urn:sys:core:tenancy:hasLicense");
export const tenantNameIRI = new IRI("urn:sys:core:tenancy:tenantName");
export const tenantUserIRI = new IRI("urn:sys:core:tenancy:tenantUser");
export const orgNameIRI = new IRI("urn:sys:core:tenancy:orgName");
export const orgTenantIRI = new IRI("urn:sys:core:tenancy:orgTenant");
export const orgUserIRI = new IRI("urn:sys:core:tenancy:orgUser");
export const orgOwnerIRI = new IRI("urn:sys:core:tenancy:orgOwner");
export const domainNameIRI = new IRI("urn:sys:core:tenancy:domainName");
export const domainDescriptionIRI = new IRI("urn:sys:core:tenancy:domainDescription");
export const domainUrlIRI = new IRI("urn:sys:core:tenancy:domainUrl");
export const domainTenantIRI = new IRI("urn:sys:core:tenancy:domainTenant");
