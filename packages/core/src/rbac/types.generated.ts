// auto-generated — do not edit by hand

import { IRI } from "../semantics/IRI.js";

/** A deployment of the platform (cloud-native, hybrid, or on-premise). Contains one or more Tenants. */
export interface Install {
    /** Human-readable install name. */
    installName?: string;
    /** True for the single system-level Install; protects it from deletion. */
    isSystemInstall?: boolean;
    /** Deployment kind: cloud, hybrid, or on-premise. */
    installKind?: string;
    /** Outward edge: an Install contains a Tenant (root→down). */
    hasTenant?: Tenant[];
}

export const InstallIRI = new IRI("urn:sys:core:rbac:Install");

/** An isolation boundary scoped to a single Install. All groups, roles, and resources belong to a tenant. */
export interface Tenant {
    /** Human-readable tenant name. */
    tenantName?: string;
    /** True for the system-level root tenant; protects it from deletion. */
    isSystemTenant?: boolean;
}

export const TenantIRI = new IRI("urn:sys:core:rbac:Tenant");

/** A named collection of principals (users, service accounts, or nested groups). */
export interface UserGroup {
    /** Human-readable user group name. */
    groupName?: string;
    /** True for system-managed groups (e.g. superusers); protects them from deletion. */
    isSystemGroup?: boolean;
    /** Scopes a group, role, service account, or resource to a tenant. */
    isInTenant?: Tenant;
}

export const UserGroupIRI = new IRI("urn:sys:core:rbac:UserGroup");

/** A non-human principal for automated or service-to-service access. */
export interface ServiceAccount {
    /** Human-readable service account name. */
    serviceAccountName?: string;
    /** Opaque credential token; callers should store the hash, not the plaintext. */
    serviceAccountToken?: string;
    /** Whether the service account is currently enabled. */
    serviceAccountIsActive?: boolean;
    /** Scopes a group, role, service account, or resource to a tenant. */
    isInTenant?: Tenant;
}

export const ServiceAccountIRI = new IRI("urn:sys:core:rbac:ServiceAccount");

/** A named set of permissions, assignable to groups or principals via a PolicyGrant. */
export interface Role {
    /** Human-readable role name. */
    roleName?: string;
    /** True for built-in system roles; protects them from deletion. */
    isSystemRole?: boolean;
    /** Scopes a group, role, service account, or resource to a tenant. */
    isInTenant?: Tenant;
    /** This role inherits all permissions from the target role. Forms a DAG — cycles are prohibited. */
    inheritsFrom?: Role[];
    /** A role directly grants a permission. */
    grants?: Permission[];
}

export const RoleIRI = new IRI("urn:sys:core:rbac:Role");

/** An atomic capability, identified by a dot-separated key such as 'invoice.read'. '*' is the wildcard. */
export interface Permission {
    /** Dot-separated action key, e.g. 'invoice.read'. '*' is the system wildcard. */
    permissionKey?: string;
}

export const PermissionIRI = new IRI("urn:sys:core:rbac:Permission");

/** An explicit binding of a principal (or group) to a role or permission within a scope. */
export interface PolicyGrant {
    /** When true this grant explicitly denies rather than allows. Denial at a tighter scope wins over an allow at a broader scope. */
    isDenial?: boolean;
    /** When the grant expires. Absent means the grant is permanent. */
    grantExpiresAt?: Date;
    /** The principal (User, UserGroup, or ServiceAccount) receiving the grant. */
    hasPrincipal?: unknown;
    /** The role being granted. Mutually exclusive with grantPermission. */
    hasRole?: Role;
    /** A direct permission grant. Mutually exclusive with grantRole. */
    hasPermission?: Permission;
    /** The resource or tenant the grant is scoped to. Absent means the grant is system-wide. */
    hasScope?: unknown;
    /** The principal who created this grant (immutable audit trail). */
    grantedBy?: unknown;
    /** The originating PolicyGrant that authorized this delegated grant. */
    delegatedFrom?: PolicyGrant;
}

export const PolicyGrantIRI = new IRI("urn:sys:core:rbac:PolicyGrant");

/** A resource that can serve as the scope for a policy grant and participate in the resource hierarchy. */
export interface ResourceNode {
    /** Application-defined resource type key, e.g. 'org', 'project', 'dataset'. */
    resourceType?: string;
    /** Scopes a group, role, service account, or resource to a tenant. */
    isInTenant?: Tenant;
    /** Parent resource in the hierarchy. Grants made on a parent propagate to all descendants. */
    hasParent?: ResourceNode;
}

export const ResourceNodeIRI = new IRI("urn:sys:core:rbac:ResourceNode");

export const installNameIRI = new IRI("urn:sys:core:rbac:installName");
export const isSystemInstallIRI = new IRI("urn:sys:core:rbac:isSystemInstall");
export const installKindIRI = new IRI("urn:sys:core:rbac:installKind");
export const tenantNameIRI = new IRI("urn:sys:core:rbac:tenantName");
export const isSystemTenantIRI = new IRI("urn:sys:core:rbac:isSystemTenant");
export const groupNameIRI = new IRI("urn:sys:core:rbac:groupName");
export const isSystemGroupIRI = new IRI("urn:sys:core:rbac:isSystemGroup");
export const serviceAccountNameIRI = new IRI("urn:sys:core:rbac:serviceAccountName");
export const serviceAccountTokenIRI = new IRI("urn:sys:core:rbac:serviceAccountToken");
export const serviceAccountIsActiveIRI = new IRI("urn:sys:core:rbac:serviceAccountIsActive");
export const roleNameIRI = new IRI("urn:sys:core:rbac:roleName");
export const isSystemRoleIRI = new IRI("urn:sys:core:rbac:isSystemRole");
export const permissionKeyIRI = new IRI("urn:sys:core:rbac:permissionKey");
export const isDenialIRI = new IRI("urn:sys:core:rbac:isDenial");
export const grantExpiresAtIRI = new IRI("urn:sys:core:rbac:grantExpiresAt");
export const resourceTypeIRI = new IRI("urn:sys:core:rbac:resourceType");
export const hasTenantIRI = new IRI("urn:sys:core:rbac:hasTenant");
export const isMemberOfIRI = new IRI("urn:sys:core:rbac:isMemberOf");
export const isInTenantIRI = new IRI("urn:sys:core:rbac:isInTenant");
export const inheritsFromIRI = new IRI("urn:sys:core:rbac:inheritsFrom");
export const grantsIRI = new IRI("urn:sys:core:rbac:grants");
export const hasParentIRI = new IRI("urn:sys:core:rbac:hasParent");
export const hasPrincipalIRI = new IRI("urn:sys:core:rbac:hasPrincipal");
export const hasRoleIRI = new IRI("urn:sys:core:rbac:hasRole");
export const hasPermissionIRI = new IRI("urn:sys:core:rbac:hasPermission");
export const hasScopeIRI = new IRI("urn:sys:core:rbac:hasScope");
export const grantedByIRI = new IRI("urn:sys:core:rbac:grantedBy");
export const delegatedFromIRI = new IRI("urn:sys:core:rbac:delegatedFrom");
export const actsForIRI = new IRI("urn:sys:core:rbac:actsFor");
