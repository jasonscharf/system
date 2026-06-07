// auto-generated — do not edit by hand
import { IRI } from "../semantics/IRI.js";

// ── Classes ────────────────────────────────────────────────────────────────

export const TenantIRI = new IRI("urn:sys:core:rbac:Tenant");
export const UserGroupIRI = new IRI("urn:sys:core:rbac:UserGroup");
export const ServiceAccountIRI = new IRI("urn:sys:core:rbac:ServiceAccount");
export const RoleIRI = new IRI("urn:sys:core:rbac:Role");
export const PermissionIRI = new IRI("urn:sys:core:rbac:Permission");
export const PolicyGrantIRI = new IRI("urn:sys:core:rbac:PolicyGrant");
export const ResourceNodeIRI = new IRI("urn:sys:core:rbac:ResourceNode");

// ── Predicate IRIs ─────────────────────────────────────────────────────────

export const tenantNameIRI = new IRI("urn:sys:core:rbac:tenantName");
export const isSystemTenantIRI = new IRI("urn:sys:core:rbac:isSystemTenant");
export const groupNameIRI = new IRI("urn:sys:core:rbac:groupName");
export const isSystemUserGroupIRI = new IRI("urn:sys:core:rbac:isSystemGroup");
export const serviceAccountNameIRI = new IRI("urn:sys:core:rbac:serviceAccountName");
export const serviceAccountTokenIRI = new IRI("urn:sys:core:rbac:serviceAccountToken");
export const rbacIsActiveIRI = new IRI("urn:sys:core:rbac:isActive");
export const roleNameIRI = new IRI("urn:sys:core:rbac:roleName");
export const isSystemRoleIRI = new IRI("urn:sys:core:rbac:isSystemRole");
export const permissionKeyIRI = new IRI("urn:sys:core:rbac:permissionKey");
export const isDenialIRI = new IRI("urn:sys:core:rbac:isDenial");
export const grantExpiresAtIRI = new IRI("urn:sys:core:rbac:grantExpiresAt");
export const resourceTypeIRI = new IRI("urn:sys:core:rbac:resourceType");
export const isMemberOfIRI = new IRI("urn:sys:core:rbac:isMemberOf");
export const isInTenantIRI = new IRI("urn:sys:core:rbac:isInTenant");
export const inheritsFromIRI = new IRI("urn:sys:core:rbac:inheritsFrom");
export const rbacGrantsIRI = new IRI("urn:sys:core:rbac:grants");
export const hasParentIRI = new IRI("urn:sys:core:rbac:hasParent");
export const hasPrincipalIRI = new IRI("urn:sys:core:rbac:hasPrincipal");
export const hasRoleIRI = new IRI("urn:sys:core:rbac:hasRole");
export const hasPermissionIRI = new IRI("urn:sys:core:rbac:hasPermission");
export const hasScopeIRI = new IRI("urn:sys:core:rbac:hasScope");
export const grantedByIRI = new IRI("urn:sys:core:rbac:grantedBy");
export const delegatedFromIRI = new IRI("urn:sys:core:rbac:delegatedFrom");
export const actsForIRI = new IRI("urn:sys:core:rbac:actsFor");

// ── Shape interfaces ───────────────────────────────────────────────────────

/** Top-level isolation boundary. */
export interface Tenant {
    tenantName?: string;
    isSystemTenant?: boolean;
}

/** Named collection of principals (users, service accounts, or nested groups). */
export interface UserGroup {
    groupName?: string;
    isSystemGroup?: boolean;
    isInTenant?: Tenant[];
}

/** Non-human principal for automation. */
export interface ServiceAccount {
    serviceAccountName?: string;
    serviceAccountToken?: string;
    isActive?: boolean;
    isInTenant?: Tenant[];
}

/** Named set of permissions. */
export interface Role {
    roleName?: string;
    isSystemRole?: boolean;
    isInTenant?: Tenant[];
    inheritsFrom?: Role[];
}

/** Atomic capability. */
export interface Permission {
    permissionKey?: string;
}

/** Explicit principal → role/permission binding within a scope. */
export interface PolicyGrant {
    isDenial?: boolean;
    grantExpiresAt?: Date;
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
    hasParent?: ResourceNode[];
    isInTenant?: Tenant[];
}
