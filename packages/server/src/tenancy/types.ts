export interface TenantEntity {
	id: string;
	iri: string;
	name: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface OrganizationEntity {
	id: string;
	iri: string;
	name: string;
	tenantIri: string;
	ownerIri: string;
	createdAt: Date;
	updatedAt: Date;
	members?: string[];
}

export interface DomainEntity {
	id: string;
	iri: string;
	name: string;
	description?: string;
	url?: string;
	createdAt: Date;
	updatedAt: Date;
}
