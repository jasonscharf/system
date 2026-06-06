export interface TenantEntity {
    id: string;
    iri: string;
    tenantName: string;
    isSystemTenant: boolean;
}

export interface UserGroupEntity {
    id: string;
    iri: string;
    groupName: string;
    isSystemGroup: boolean;
    tenantId: string | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface ServiceAccountEntity {
    id: string;
    iri: string;
    serviceAccountName: string;
    serviceAccountToken: string;
    isActive: boolean;
    tenantId: string | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface RoleEntity {
    id: string;
    iri: string;
    roleName: string;
    isSystemRole: boolean;
    tenantId: string | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface PermissionEntity {
    id: string;
    iri: string;
    permissionKey: string;
}

/**
 * An explicit principal → role/permission binding, optionally scoped to a
 * resource or tenant and optionally time-bounded.
 *
 * Either roleIri or permissionIri is set, never both.
 * scopeIri absent = system-wide grant.
 * delegatedFromIri present = grant was created via delegation.
 */
export interface PolicyGrantEntity {
    id: string;
    iri: string;
    principalIri: string;
    roleIri: string | null;
    permissionIri: string | null;
    scopeIri: string | null;
    grantedByIri: string | null;
    delegatedFromIri: string | null;
    grantExpiresAt: Date | null;
    isDenial: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface ResourceNodeEntity {
    id: string;
    iri: string;
    resourceType: string;
    parentIri: string | null;
    tenantId: string | null;
    createdAt: Date;
    updatedAt: Date;
}

/** Internal full check options used by AccessChecker. */
export interface CheckOptions {
    /** IRI of the real caller (User or ServiceAccount). */
    principal: string;
    /** Dot-separated permission key, e.g. 'invoice.read'. */
    permission: string;
    /** IRI of the resource or tenant to scope the check to. Absent = system-wide. */
    scope?: string;
    /**
     * When set, the caller is requesting to act as this principal (impersonation).
     * The check verifies principal --actsFor--> actingAs and then evaluates as actingAs.
     */
    actingAs?: string;
}

/** Args for RbacService.can() / assert() — principal and actingAs come from SecurityContext. */
export interface RbacCheckArgs {
    /** Dot-separated permission key, e.g. 'invoice.read'. */
    permission: string;
    /** IRI of the resource or tenant to scope the check to. Absent = system-wide. */
    scope?: string;
}
