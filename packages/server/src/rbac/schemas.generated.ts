// auto-generated — do not edit by hand

import { IRI } from "@jasonscharf/core";
import { EntitySchema } from "@jasonscharf/entities";

/** Top-level isolation boundary. All groups, roles, and resources belong to a tenant. */
export const TenantSchema: EntitySchema = new EntitySchema({
    typeIRI: new IRI("urn:sys:core:rbac:Tenant"),
    ns: "urn:sys:core:rbac:",
    graphIri: new IRI("urn:sys:core:rbac:graph"),
    properties: {
        tenantName: new IRI("urn:sys:core:rbac:tenantName"),
        isSystemTenant: new IRI("urn:sys:core:rbac:isSystemTenant"),
    },
});

/** A named collection of principals (users, service accounts, or nested groups). */
export const UserGroupSchema: EntitySchema = new EntitySchema({
    typeIRI: new IRI("urn:sys:core:rbac:UserGroup"),
    ns: "urn:sys:core:rbac:",
    idSegment: "group",
    graphIri: new IRI("urn:sys:core:rbac:graph"),
    properties: {
        groupName: new IRI("urn:sys:core:rbac:groupName"),
        isSystemGroup: new IRI("urn:sys:core:rbac:isSystemGroup"),
    },
    edges: {
        isInTenant: {
            predicate: new IRI("urn:sys:core:rbac:isInTenant"),
            target: () => TenantSchema,
            cardinality: "one",
            direction: "out",
        },
    },
});

/** A non-human principal for automated or service-to-service access. */
export const ServiceAccountSchema: EntitySchema = new EntitySchema({
    typeIRI: new IRI("urn:sys:core:rbac:ServiceAccount"),
    ns: "urn:sys:core:rbac:",
    idSegment: "sa",
    graphIri: new IRI("urn:sys:core:rbac:graph"),
    properties: {
        serviceAccountName: new IRI("urn:sys:core:rbac:serviceAccountName"),
        serviceAccountToken: new IRI("urn:sys:core:rbac:serviceAccountToken"),
        isActive: new IRI("urn:sys:core:rbac:isActive"),
    },
    edges: {
        isInTenant: {
            predicate: new IRI("urn:sys:core:rbac:isInTenant"),
            target: () => TenantSchema,
            cardinality: "one",
            direction: "out",
        },
    },
});

/** A named set of permissions, assignable to groups or principals via a PolicyGrant. */
export const RoleSchema: EntitySchema = new EntitySchema({
    typeIRI: new IRI("urn:sys:core:rbac:Role"),
    ns: "urn:sys:core:rbac:",
    graphIri: new IRI("urn:sys:core:rbac:graph"),
    properties: {
        roleName: new IRI("urn:sys:core:rbac:roleName"),
        isSystemRole: new IRI("urn:sys:core:rbac:isSystemRole"),
    },
    edges: {
        isInTenant: {
            predicate: new IRI("urn:sys:core:rbac:isInTenant"),
            target: () => TenantSchema,
            cardinality: "one",
            direction: "out",
        },
        inheritsFrom: {
            predicate: new IRI("urn:sys:core:rbac:inheritsFrom"),
            target: () => RoleSchema,
            cardinality: "many",
            direction: "out",
        },
        grants: {
            predicate: new IRI("urn:sys:core:rbac:grants"),
            target: () => PermissionSchema,
            cardinality: "many",
            direction: "out",
        },
    },
});

/** An atomic capability, identified by a dot-separated key such as 'invoice.read'. '*' is the wildcard. */
export const PermissionSchema: EntitySchema = new EntitySchema({
    typeIRI: new IRI("urn:sys:core:rbac:Permission"),
    ns: "urn:sys:core:rbac:",
    graphIri: new IRI("urn:sys:core:rbac:graph"),
    properties: {
        permissionKey: new IRI("urn:sys:core:rbac:permissionKey"),
    },
});

/** An explicit binding of a principal (or group) to a role or permission within a scope. */
export const PolicyGrantSchema: EntitySchema = new EntitySchema({
    typeIRI: new IRI("urn:sys:core:rbac:PolicyGrant"),
    ns: "urn:sys:core:rbac:",
    idSegment: "grant",
    graphIri: new IRI("urn:sys:core:rbac:graph"),
    properties: {
        isDenial: new IRI("urn:sys:core:rbac:isDenial"),
        grantExpiresAt: new IRI("urn:sys:core:rbac:grantExpiresAt"),
    },
    edges: {
        hasPrincipal: {
            predicate: new IRI("urn:sys:core:rbac:hasPrincipal"),
            cardinality: "one",
            direction: "out",
        },
        hasRole: {
            predicate: new IRI("urn:sys:core:rbac:hasRole"),
            target: () => RoleSchema,
            cardinality: "one",
            direction: "out",
        },
        hasPermission: {
            predicate: new IRI("urn:sys:core:rbac:hasPermission"),
            target: () => PermissionSchema,
            cardinality: "one",
            direction: "out",
        },
        hasScope: {
            predicate: new IRI("urn:sys:core:rbac:hasScope"),
            cardinality: "one",
            direction: "out",
        },
        grantedBy: {
            predicate: new IRI("urn:sys:core:rbac:grantedBy"),
            cardinality: "one",
            direction: "out",
        },
        delegatedFrom: {
            predicate: new IRI("urn:sys:core:rbac:delegatedFrom"),
            target: () => PolicyGrantSchema,
            cardinality: "one",
            direction: "out",
        },
    },
});

/** A resource that can serve as the scope for a policy grant and participate in the resource hierarchy. */
export const ResourceNodeSchema: EntitySchema = new EntitySchema({
    typeIRI: new IRI("urn:sys:core:rbac:ResourceNode"),
    ns: "urn:sys:core:rbac:",
    idSegment: "resource",
    graphIri: new IRI("urn:sys:core:rbac:graph"),
    properties: {
        resourceType: new IRI("urn:sys:core:rbac:resourceType"),
    },
    edges: {
        isInTenant: {
            predicate: new IRI("urn:sys:core:rbac:isInTenant"),
            target: () => TenantSchema,
            cardinality: "one",
            direction: "out",
        },
        hasParent: {
            predicate: new IRI("urn:sys:core:rbac:hasParent"),
            target: () => ResourceNodeSchema,
            cardinality: "one",
            direction: "out",
        },
    },
});
