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
