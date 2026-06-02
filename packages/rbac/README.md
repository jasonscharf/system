# @jasonscharf/rbac

Role-based access control for the Tern platform. Principals (users, service accounts) hold roles that grant permissions, scoped optionally to a resource hierarchy.

## Concepts

- **Tenant** — top-level isolation boundary; all other entities belong to a tenant
- **Role** — named collection of permissions
- **Permission** — named capability key (e.g. `"products:write"`)
- **PolicyGrant** — binds a principal to a role, optionally scoped to a resource
- **ResourceNode** — node in a resource tree (scope inheritance flows from parent to child)
- **UserGroup** — set of users that can be granted roles together

## Setup

```typescript
import {
    RbacService,
    TenantRepository,
    UserGroupRepository,
    RoleRepository,
    PermissionRepository,
    PolicyGrantRepository,
    ResourceNodeRepository,
    ServiceAccountRepository,
} from '@jasonscharf/rbac';
import { EntityStore } from '@jasonscharf/server';

const store = new EntityStore(/* knex */);

const rbac = new RbacService({
    tenantRepo:    new TenantRepository(store),
    groupRepo:     new UserGroupRepository(store),
    roleRepo:      new RoleRepository(store),
    permRepo:      new PermissionRepository(store),
    grantRepo:     new PolicyGrantRepository(store),
    resourceRepo:  new ResourceNodeRepository(store),
    saRepo:        new ServiceAccountRepository(store),
});
```

## Permission Checks

```typescript
// Boolean check
const allowed = await rbac.can(ctx, {
    principal:  userIri,
    permission: 'products:write',
    scope:      resourceIri,  // optional
});

// Assert (throws RbacError on denial)
await rbac.assert(ctx, {
    principal:  userIri,
    permission: 'products:write',
});

// Resolve all permissions for a principal
const perms = await rbac.resolvePermissions(ctx, userIri, scopeIri);
```

## Tenants, Roles, and Grants

```typescript
// Create a tenant
const tenant = await rbac.createTenant(ctx, { tenantName: 'Acme Corp' });

// Create a role
const role = await rbac.createRole(ctx, { roleName: 'editor', tenantIri: tenant.iri });

// Create a permission
const perm = await rbac.createPermission(ctx, { permissionKey: 'products:write' });

// Grant the role to a user
await rbac.createGrant(ctx, {
    principalIri: userIri,
    roleIri:      role.iri,
    scopeIri:     resourceIri,  // optional scope
});
```

## Resource Hierarchy

Permissions granted at a parent resource node are inherited by all descendants.

```typescript
const root    = await rbac.createResource(ctx, { resourceType: 'Workspace' });
const project = await rbac.createResource(ctx, { resourceType: 'Project', parentIri: root.iri });

// Grant at root; user can act on root and all children
await rbac.createGrant(ctx, { principalIri: userIri, roleIri: editorRole.iri, scopeIri: root.iri });
```

## Seeding System Roles

```typescript
import { seed } from '@jasonscharf/rbac';

// Run once at install time to create system-level roles and permissions
await seed(ctx, rbac);
```

## Ontology

RBAC ontology (`rbac.ttl`) ships with `@jasonscharf/core` under `ontology/`.

## Installation

```bash
yarn add @jasonscharf/rbac
```

Published to GitHub Packages (`https://npm.pkg.github.com`).
