// auto-generated — do not edit by hand

import { IRI } from "@jasonscharf/core";
import { EntitySchema } from "@jasonscharf/entities";

/** Top-level isolation boundary. All groups, roles, and resources belong to a tenant. */
export const TenantSchema: EntitySchema = new EntitySchema({
    typeIRI: new IRI("http://tern.dev/ns/rbac/Tenant"),
    ns: "http://tern.dev/ns/rbac/",
    graphIri: new IRI("http://tern.dev/ns/rbac/graph"),
    properties: {
        tenantName: new IRI("http://tern.dev/ns/rbac/tenantName"),
        isSystemTenant: new IRI("http://tern.dev/ns/rbac/isSystemTenant"),
    },
});

/** A named collection of principals (users, service accounts, or nested groups). */
export const UserGroupSchema: EntitySchema = new EntitySchema({
    typeIRI: new IRI("http://tern.dev/ns/rbac/UserGroup"),
    ns: "http://tern.dev/ns/rbac/",
    graphIri: new IRI("http://tern.dev/ns/rbac/graph"),
    properties: {
        groupName: new IRI("http://tern.dev/ns/rbac/groupName"),
        isSystemGroup: new IRI("http://tern.dev/ns/rbac/isSystemGroup"),
    },
    edges: {
        isInTenant: {
            predicate: new IRI("http://tern.dev/ns/rbac/isInTenant"),
            target: () => TenantSchema,
            cardinality: "many",
            direction: "out",
        },
    },
});

/** A non-human principal for automated or service-to-service access. */
export const ServiceAccountSchema: EntitySchema = new EntitySchema({
    typeIRI: new IRI("http://tern.dev/ns/rbac/ServiceAccount"),
    ns: "http://tern.dev/ns/rbac/",
    graphIri: new IRI("http://tern.dev/ns/rbac/graph"),
    properties: {
        serviceAccountName: new IRI("http://tern.dev/ns/rbac/serviceAccountName"),
        serviceAccountToken: new IRI("http://tern.dev/ns/rbac/serviceAccountToken"),
        isActive: new IRI("http://tern.dev/ns/rbac/isActive"),
    },
    edges: {
        isInTenant: {
            predicate: new IRI("http://tern.dev/ns/rbac/isInTenant"),
            target: () => TenantSchema,
            cardinality: "many",
            direction: "out",
        },
    },
});

/** A named set of permissions, assignable to groups or principals via a PolicyGrant. */
export const RoleSchema: EntitySchema = new EntitySchema({
    typeIRI: new IRI("http://tern.dev/ns/rbac/Role"),
    ns: "http://tern.dev/ns/rbac/",
    graphIri: new IRI("http://tern.dev/ns/rbac/graph"),
    properties: {
        roleName: new IRI("http://tern.dev/ns/rbac/roleName"),
        isSystemRole: new IRI("http://tern.dev/ns/rbac/isSystemRole"),
    },
    edges: {
        isInTenant: {
            predicate: new IRI("http://tern.dev/ns/rbac/isInTenant"),
            target: () => TenantSchema,
            cardinality: "many",
            direction: "out",
        },
        inheritsFrom: {
            predicate: new IRI("http://tern.dev/ns/rbac/inheritsFrom"),
            target: () => RoleSchema,
            cardinality: "many",
            direction: "out",
        },
        grants: {
            predicate: new IRI("http://tern.dev/ns/rbac/grants"),
            target: () => PermissionSchema,
            cardinality: "many",
            direction: "out",
        },
    },
});

/** An atomic capability, identified by a dot-separated key such as 'invoice.read'. '*' is the wildcard. */
export const PermissionSchema: EntitySchema = new EntitySchema({
    typeIRI: new IRI("http://tern.dev/ns/rbac/Permission"),
    ns: "http://tern.dev/ns/rbac/",
    graphIri: new IRI("http://tern.dev/ns/rbac/graph"),
    properties: {
        permissionKey: new IRI("http://tern.dev/ns/rbac/permissionKey"),
    },
});

/** An explicit binding of a principal (or group) to a role or permission within a scope. */
export const PolicyGrantSchema: EntitySchema = new EntitySchema({
    typeIRI: new IRI("http://tern.dev/ns/rbac/PolicyGrant"),
    ns: "http://tern.dev/ns/rbac/",
    graphIri: new IRI("http://tern.dev/ns/rbac/graph"),
    properties: {
        isDenial: new IRI("http://tern.dev/ns/rbac/isDenial"),
        grantExpiresAt: new IRI("http://tern.dev/ns/rbac/grantExpiresAt"),
    },
    edges: {
        hasPrincipal: {
            predicate: new IRI("http://tern.dev/ns/rbac/hasPrincipal"),
            cardinality: "many",
            direction: "out",
        },
        hasRole: {
            predicate: new IRI("http://tern.dev/ns/rbac/hasRole"),
            target: () => RoleSchema,
            cardinality: "many",
            direction: "out",
        },
        hasPermission: {
            predicate: new IRI("http://tern.dev/ns/rbac/hasPermission"),
            target: () => PermissionSchema,
            cardinality: "many",
            direction: "out",
        },
        hasScope: {
            predicate: new IRI("http://tern.dev/ns/rbac/hasScope"),
            cardinality: "many",
            direction: "out",
        },
        grantedBy: {
            predicate: new IRI("http://tern.dev/ns/rbac/grantedBy"),
            cardinality: "many",
            direction: "out",
        },
        delegatedFrom: {
            predicate: new IRI("http://tern.dev/ns/rbac/delegatedFrom"),
            target: () => PolicyGrantSchema,
            cardinality: "many",
            direction: "out",
        },
    },
});

/** A resource that can serve as the scope for a policy grant and participate in the resource hierarchy. */
export const ResourceNodeSchema: EntitySchema = new EntitySchema({
    typeIRI: new IRI("http://tern.dev/ns/rbac/ResourceNode"),
    ns: "http://tern.dev/ns/rbac/",
    graphIri: new IRI("http://tern.dev/ns/rbac/graph"),
    properties: {
        resourceType: new IRI("http://tern.dev/ns/rbac/resourceType"),
    },
    edges: {
        isInTenant: {
            predicate: new IRI("http://tern.dev/ns/rbac/isInTenant"),
            target: () => TenantSchema,
            cardinality: "many",
            direction: "out",
        },
        hasParent: {
            predicate: new IRI("http://tern.dev/ns/rbac/hasParent"),
            target: () => ResourceNodeSchema,
            cardinality: "many",
            direction: "out",
        },
    },
});
