# @jasonscharf/core

Foundational types and interfaces for the Tern platform. Every other package depends on this one.

## What it provides

- **ApplicationContext** — the context object passed as `ctx` to every system-level method
- **RDF term types** — `IRI`, `Literal`, `BlankNode`, `Triple`, `Quad`
- **IDomainEventBus** — event bus interface (`publish`, `subscribe`)
- **DomainEvent** — typed domain event wrapper
- **ServiceContainer** / **ServiceToken** — lightweight, type-safe IoC container
- **TernMessage** — wire format for commands, queries, events, and results
- **PrefixRegistry** — IRI namespace prefix management
- **AuthRBAC** — shared RBAC types (roles, permissions)
- **Utilities** — `uuid`, `random`, `binary`, async helpers, object utilities

## Ontologies

The `ontology/` directory ships with the package and contains the canonical OWL definitions for the platform:

| File | Namespace | Defines |
|---|---|---|
| `core.ttl` | `http://tern.dev/ns/core/` | CollectionView, CollectionViewItem |
| `auth.ttl` | `http://tern.dev/ns/auth/` | User, UserIdentity, UserSession, UserDevice |
| `auth.shacl.ttl` | SHACL shapes | Validation constraints for auth entities |
| `rbac.ttl` | `http://tern.dev/ns/rbac/` | Tenant, Role, Permission, PolicyGrant, ResourceNode |

## Installation

```bash
npm install @jasonscharf/core
```

Published to GitHub Packages (`https://npm.pkg.github.com`).

## ApplicationContext

Every system-level function accepts `ctx` as its **first parameter**. This is the single most important convention in the platform.

```typescript
import type { ApplicationContext } from '@jasonscharf/core';
import { defaultCtx } from '@jasonscharf/core';

// Reading from ctx
function doWork(ctx: ApplicationContext, id: string): void {
    ctx.logger?.info('doing work', { id });
    ctx.events?.publish({ type: 'work.done', payload: { id } });
}

// The exported no-op context for tests and bootstrapping
doWork(defaultCtx, 'abc');
```

Add application-specific fields via module augmentation:

```typescript
declare module '@jasonscharf/core' {
    interface ApplicationContext {
        tenantId?: string;
    }
}
```

## Event Bus

`IDomainEventBus` is the interface; `@jasonscharf/events` provides the implementations.

```typescript
import type { IDomainEventBus, DomainEvent } from '@jasonscharf/core';

// Subscribe
await ctx.events!.subscribe(
    'http://example.com/events/UserCreated',
    'my-extension.user-created',
    async (event: DomainEvent<{ userId: string }>) => {
        // handle event
    },
);

// Publish
await ctx.events!.publish<{ userId: string }>({
    type: 'http://example.com/events/UserCreated',
    payload: { userId: 'u1' },
});
```

## ServiceContainer

```typescript
import { ServiceContainer, ServiceToken } from '@jasonscharf/core';

const MY_SERVICE = new ServiceToken<MyService>('MyService');

const container = new ServiceContainer();
container.bind(MY_SERVICE, new MyService());

const svc = container.resolve(MY_SERVICE); // typed as MyService
```

## RDF Terms

```typescript
import { IRI, Literal, BlankNode, Triple } from '@jasonscharf/core';

const subject   = new IRI('http://example.com/user/1');
const predicate = new IRI('http://tern.dev/ns/auth/email');
const object    = Literal.string('alice@example.com');
const triple    = new Triple(subject, predicate, object);
```

## TernMessage wire format

```typescript
import { TernMessage } from '@jasonscharf/core';

// All messages share this shape:
const msg: TernMessage = {
    id: 'msg-uuid',
    kind: 'command',           // 'command' | 'query' | 'event' | 'result'
    type: 'http://example.com/commands/CreateUser',
    payload: { email: 'alice@example.com' },
};
```
