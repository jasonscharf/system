import type { EdgeRef } from "@jasonscharf/entities";

export interface UserGroupEntity {
    id: string;
    iri: string;
    groupName: string;
    isSystemGroup: boolean;
    /** Tenant this group belongs to — a topological edge, not a tenantId scalar. */
    isInTenant: EdgeRef | null;
}

export interface ServiceAccountEntity {
    id: string;
    iri: string;
    serviceAccountName: string;
    serviceAccountToken: string;
    isActive: boolean;
    isInTenant: EdgeRef | null;
}

export interface RoleEntity {
    id: string;
    iri: string;
    roleName: string;
    isSystemRole: boolean;
    isInTenant: EdgeRef | null;
}

export interface PermissionEntity {
    id: string;
    iri: string;
    permissionKey: string;
}

/**
 * An explicit principal → role/permission binding, optionally scoped to a
 * resource or tenant and optionally time-bounded. Every relationship is a
 * topological edge (hasRole, hasScope, …), never a `fooId` "foreign key" scalar.
 *
 * Either hasRole or hasPermission is set, never both.
 * hasScope absent = system-wide grant.  delegatedFrom present = via delegation.
 */
export interface PolicyGrantEntity {
    id: string;
    iri: string;
    hasPrincipal: EdgeRef | null;
    hasRole: EdgeRef | null;
    hasPermission: EdgeRef | null;
    hasScope: EdgeRef | null;
    grantedBy: EdgeRef | null;
    delegatedFrom: EdgeRef | null;
    grantExpiresAt: Date | null;
    isDenial: boolean;
}

export interface ResourceNodeEntity {
    id: string;
    iri: string;
    resourceType: string;
    hasParent: EdgeRef | null;
    isInTenant: EdgeRef | null;
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
