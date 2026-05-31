// auto-generated — do not edit by hand
import { IRI } from "../semantics/IRI.js";

// ── Classes ────────────────────────────────────────────────────────────────

export const TenantIRI = new IRI("http://tern.dev/ns/rbac/Tenant");
export const UserGroupIRI = new IRI("http://tern.dev/ns/rbac/UserGroup");
export const ServiceAccountIRI = new IRI("http://tern.dev/ns/rbac/ServiceAccount");
export const RoleIRI = new IRI("http://tern.dev/ns/rbac/Role");
export const PermissionIRI = new IRI("http://tern.dev/ns/rbac/Permission");
export const PolicyGrantIRI = new IRI("http://tern.dev/ns/rbac/PolicyGrant");
export const ResourceNodeIRI = new IRI("http://tern.dev/ns/rbac/ResourceNode");

// ── Predicate IRIs ─────────────────────────────────────────────────────────

export const tenantNameIRI = new IRI("http://tern.dev/ns/rbac/tenantName");
export const isSystemTenantIRI = new IRI("http://tern.dev/ns/rbac/isSystemTenant");
export const groupNameIRI = new IRI("http://tern.dev/ns/rbac/groupName");
export const isSystemUserGroupIRI = new IRI("http://tern.dev/ns/rbac/isSystemGroup");
export const serviceAccountNameIRI = new IRI("http://tern.dev/ns/rbac/serviceAccountName");
export const serviceAccountTokenIRI = new IRI("http://tern.dev/ns/rbac/serviceAccountToken");
export const rbacIsActiveIRI = new IRI("http://tern.dev/ns/rbac/isActive");
export const roleNameIRI = new IRI("http://tern.dev/ns/rbac/roleName");
export const isSystemRoleIRI = new IRI("http://tern.dev/ns/rbac/isSystemRole");
export const permissionKeyIRI = new IRI("http://tern.dev/ns/rbac/permissionKey");
export const isDenialIRI = new IRI("http://tern.dev/ns/rbac/isDenial");
export const grantExpiresAtIRI = new IRI("http://tern.dev/ns/rbac/grantExpiresAt");
export const resourceTypeIRI = new IRI("http://tern.dev/ns/rbac/resourceType");
export const rbacCreatedAtIRI = new IRI("http://tern.dev/ns/rbac/createdAt");
export const rbacUpdatedAtIRI = new IRI("http://tern.dev/ns/rbac/updatedAt");
export const memberOfIRI = new IRI("http://tern.dev/ns/rbac/memberOf");
export const inTenantIRI = new IRI("http://tern.dev/ns/rbac/inTenant");
export const inheritsFromIRI = new IRI("http://tern.dev/ns/rbac/inheritsFrom");
export const rbacGrantsIRI = new IRI("http://tern.dev/ns/rbac/grants");
export const parentResourceIRI = new IRI("http://tern.dev/ns/rbac/parentResource");
export const grantPrincipalIRI = new IRI("http://tern.dev/ns/rbac/grantPrincipal");
export const grantRoleIRI = new IRI("http://tern.dev/ns/rbac/grantRole");
export const grantPermissionIRI = new IRI("http://tern.dev/ns/rbac/grantPermission");
export const grantScopeIRI = new IRI("http://tern.dev/ns/rbac/grantScope");
export const grantedByIRI = new IRI("http://tern.dev/ns/rbac/grantedBy");
export const delegatedFromIRI = new IRI("http://tern.dev/ns/rbac/delegatedFrom");
export const actsForIRI = new IRI("http://tern.dev/ns/rbac/actsFor");

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
    inTenant?: Tenant[];
}

/** Non-human principal for automation. */
export interface ServiceAccount {
    serviceAccountName?: string;
    serviceAccountToken?: string;
    isActive?: boolean;
    createdAt?: Date;
    updatedAt?: Date;
    inTenant?: Tenant[];
}

/** Named set of permissions. */
export interface Role {
    roleName?: string;
    isSystemRole?: boolean;
    createdAt?: Date;
    updatedAt?: Date;
    inTenant?: Tenant[];
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
    grantPrincipal?: unknown[];
    grantRole?: Role[];
    grantPermission?: Permission[];
    grantScope?: unknown[];
    grantedBy?: unknown[];
    delegatedFrom?: PolicyGrant[];
}

/** Resource that participates in the hierarchy. */
export interface ResourceNode {
    resourceType?: string;
    createdAt?: Date;
    updatedAt?: Date;
    parentResource?: ResourceNode[];
    inTenant?: Tenant[];
}
