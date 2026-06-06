// auto-generated — do not edit by hand
import { IRI } from "../semantics/IRI.js";

// ── Classes ────────────────────────────────────────────────────────────────

export const TenantIRI = new IRI("urn:tern:core:rbac:Tenant");
export const UserGroupIRI = new IRI("urn:tern:core:rbac:UserGroup");
export const ServiceAccountIRI = new IRI("urn:tern:core:rbac:ServiceAccount");
export const RoleIRI = new IRI("urn:tern:core:rbac:Role");
export const PermissionIRI = new IRI("urn:tern:core:rbac:Permission");
export const PolicyGrantIRI = new IRI("urn:tern:core:rbac:PolicyGrant");
export const ResourceNodeIRI = new IRI("urn:tern:core:rbac:ResourceNode");

// ── Predicate IRIs ─────────────────────────────────────────────────────────

export const tenantNameIRI = new IRI("urn:tern:core:rbac:tenantName");
export const isSystemTenantIRI = new IRI("urn:tern:core:rbac:isSystemTenant");
export const groupNameIRI = new IRI("urn:tern:core:rbac:groupName");
export const isSystemUserGroupIRI = new IRI("urn:tern:core:rbac:isSystemGroup");
export const serviceAccountNameIRI = new IRI("urn:tern:core:rbac:serviceAccountName");
export const serviceAccountTokenIRI = new IRI("urn:tern:core:rbac:serviceAccountToken");
export const rbacIsActiveIRI = new IRI("urn:tern:core:rbac:isActive");
export const roleNameIRI = new IRI("urn:tern:core:rbac:roleName");
export const isSystemRoleIRI = new IRI("urn:tern:core:rbac:isSystemRole");
export const permissionKeyIRI = new IRI("urn:tern:core:rbac:permissionKey");
export const isDenialIRI = new IRI("urn:tern:core:rbac:isDenial");
export const grantExpiresAtIRI = new IRI("urn:tern:core:rbac:grantExpiresAt");
export const resourceTypeIRI = new IRI("urn:tern:core:rbac:resourceType");
export const rbacCreatedAtIRI = new IRI("urn:tern:core:rbac:createdAt");
export const rbacUpdatedAtIRI = new IRI("urn:tern:core:rbac:updatedAt");
export const isMemberOfIRI = new IRI("urn:tern:core:rbac:isMemberOf");
export const isInTenantIRI = new IRI("urn:tern:core:rbac:isInTenant");
export const inheritsFromIRI = new IRI("urn:tern:core:rbac:inheritsFrom");
export const rbacGrantsIRI = new IRI("urn:tern:core:rbac:grants");
export const hasParentIRI = new IRI("urn:tern:core:rbac:hasParent");
export const hasPrincipalIRI = new IRI("urn:tern:core:rbac:hasPrincipal");
export const hasRoleIRI = new IRI("urn:tern:core:rbac:hasRole");
export const hasPermissionIRI = new IRI("urn:tern:core:rbac:hasPermission");
export const hasScopeIRI = new IRI("urn:tern:core:rbac:hasScope");
export const grantedByIRI = new IRI("urn:tern:core:rbac:grantedBy");
export const delegatedFromIRI = new IRI("urn:tern:core:rbac:delegatedFrom");
export const actsForIRI = new IRI("urn:tern:core:rbac:actsFor");

// ── Shape interfaces ───────────────────────────────────────────────────────

/** Top-level isolation boundary. */
export interface Tenant {
    tenantName?: string;
    isSystemTenant?: boolean;
    createdAt?: Date;
    updatedAt?: Date;
}

/** Named collection of principals (users, service accounts, or nested groups). */
export interface UserGroup {
    groupName?: string;
    isSystemGroup?: boolean;
    createdAt?: Date;
    updatedAt?: Date;
    isInTenant?: Tenant[];
}

/** Non-human principal for automation. */
export interface ServiceAccount {
    serviceAccountName?: string;
    serviceAccountToken?: string;
    isActive?: boolean;
    createdAt?: Date;
    updatedAt?: Date;
    isInTenant?: Tenant[];
}

/** Named set of permissions. */
export interface Role {
    roleName?: string;
    isSystemRole?: boolean;
    createdAt?: Date;
    updatedAt?: Date;
    isInTenant?: Tenant[];
    inheritsFrom?: Role[];
}

/** Atomic capability. */
export interface Permission {
    permissionKey?: string;
    createdAt?: Date;
}

/** Explicit principal → role/permission binding within a scope. */
export interface PolicyGrant {
    isDenial?: boolean;
    grantExpiresAt?: Date;
    createdAt?: Date;
    updatedAt?: Date;
    hasPrincipal?: unknown[];
    hasRole?: Role[];
    hasPermission?: Permission[];
    hasScope?: unknown[];
    grantedBy?: unknown[];
    delegatedFrom?: PolicyGrant[];
}

/** Resource that participates in the hierarchy. */
export interface ResourceNode {
    resourceType?: string;
    createdAt?: Date;
    updatedAt?: Date;
    hasParent?: ResourceNode[];
    isInTenant?: Tenant[];
}
