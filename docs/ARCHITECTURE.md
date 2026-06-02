# Tern Platform — Architecture Guide

> Authoritative reference for agents and developers building applications and extensions on Tern. Read this before writing any code.

---

## Table of Contents

1. [Core Philosophy](#core-philosophy)
2. [Everything is Quads](#everything-is-quads)
3. [Packages and Their Roles](#packages-and-their-roles)
4. [Entities](#entities)
5. [Extension Data — Arbitrary Subgraphs](#extension-data--arbitrary-subgraphs)
6. [The ServerContext](#the-servercontext)
7. [EntityStore — CRUD and Collections](#entitystore)
8. [The Event Bus](#the-event-bus)
9. [Flow-Based Programming](#flow-based-programming)
10. [Extensions](#extensions)
11. [Applications](#applications)
12. [Auth and RBAC](#auth-and-rbac)
13. [Secrets and Configuration](#secrets-and-configuration)
14. [Codegen from Ontologies](#codegen-from-ontologies)
15. [Tenancy](#tenancy)
16. [Testing Rules](#testing-rules)
17. [Style Rules](#style-rules)
18. [Complete Boot Sequence](#complete-boot-sequence)

---

## Core Philosophy

Tern is a **graph-native**, **semantic-centric** application platform. Every rule below flows from three invariants:

1. **Everything is RDF quads.** All domain data, all configuration, all entity definitions are representable as subject–predicate–object–graph quads stored in a relational database (SQLite or PostgreSQL).

2. **Everything is an extension.** There is no privileged application code. Core, auth, RBAC, analytics — all are extensions that contribute entity schemas and install themselves idempotently. Extensions hang their own data off entities as independent named subgraphs; they never modify another package's data.

3. **Loose coupling through message passing.** Components never call each other directly. They communicate through typed ports (FBP) and domain events. Unknown implementations produce empty results, not errors.

---

## Everything is Quads

The database stores RDF quads. A "quad" is `(subject, predicate, object, graph)` where each term is an IRI or literal. Every entity field, every relationship, every configuration value is one or more quads.

**Why this matters for you as a developer:**
- There is no fixed schema to ALTER. Adding a property means defining an IRI and writing triples.
- Any package can extend any entity without a migration — the Open World Assumption applies.
- The triple store is the single source of truth. No shadow tables, no JSON blobs.
- The graph is **time-series native**: writes are soft-deleted and timestamped, so the store can be queried at any point in time. Full undo/redo is a first-class capability of the platform.

**Why this is AI-native:**
Semantic Web vocabularies (OWL, SHACL, RDF) are part of the training data of every major language model. When entity schemas are expressed as standard ontologies, an AI agent can read the `.ttl` files and immediately understand the data model — its classes, properties, constraints, and relationships — without any translation layer. The graph structure also maps naturally to the way LLMs reason about knowledge, making semantic queries, schema inference, and data summarisation significantly more effective than with opaque relational schemas.

The central RDF types/IRIs are defined in `@jasonscharf/core/ontology/`:

| File | Namespace prefix | Key classes |
|---|---|---|
| `core.ttl` | `tern:` | CollectionView, CollectionViewItem |
| `auth.ttl` | `auth:` | User, UserIdentity, UserSession, UserDevice |
| `auth.shacl.ttl` | — | SHACL constraints for auth entities |
| `rbac.ttl` | `rbac:` | Tenant, Role, Permission, PolicyGrant, ResourceNode |

---

## Packages and Their Roles

```
@jasonscharf/core          Foundation types, ApplicationContext, IRI, event bus interface
@jasonscharf/entities      EntitySchema, EntityRecord — entity identity and type registry
@jasonscharf/data          Database setup (createDataContext), TripleStore (raw quad access)
@jasonscharf/server        EntityStore (CRUD+queries), EntityQuery (fluent), ServerContext
@jasonscharf/events        InMemoryEventBus (dev/test), RedisStreamEventBus (prod)
@jasonscharf/gen           Codegen CLI: OWL ontology + SHACL → TypeScript types + runtime shapes
@jasonscharf/auth          User/Session/Device/Identity schemas, AuthService, OAuth providers
@jasonscharf/rbac          RbacService, permission checking, tenant/role/grant management
@jasonscharf/flow          FBP runtime: FlowApp, FlowComponent, FlowPort, HTTP/WS components
@jasonscharf/app           TernApp, TernExtension lifecycle, HandlerRegistry
@jasonscharf/vaults        SecretsManager, pluggable secret backends (env, Azure KV)
@jasonscharf/convos        Conversations, messages, notifications extension
@jasonscharf/api           Minimal health-check HTTP endpoint
```

**Dependency direction:** `core ← entities ← data ← server ← auth/rbac ← app`  
`flow` depends on `core` only. `events` depends on `core` only. `vaults` depends on nothing.

---

## Entities

An **entity** is an identified graph node — a UUID paired with an IRI that names it within a namespace.

```
IRI:  http://example.com/ns/products/550e8400-e29b-41d4-a716-446655440000
Type: http://example.com/ns/Product
```

All properties of an entity are triples with the entity IRI as subject:

```turtle
<http://example.com/ns/products/123> rdf:type        ex:Product ;
                                      ex:name         "Widget" ;
                                      ex:price        "9.99"^^xsd:decimal ;
                                      ex:createdAt    "2024-01-01T00:00:00Z"^^xsd:dateTime .
```

### Defining an entity schema

```typescript
import { EntitySchema } from '@jasonscharf/entities';
import { IRI } from '@jasonscharf/core';

const NS = 'http://example.com/ns/';

export const ProductSchema = new EntitySchema({
    typeIri:   new IRI(`${NS}Product`),
    namespace: NS,
});
```

The schema registers the entity type with the platform. `EntityStore` uses it for CRUD operations, type-scoped queries, and namespace management.

### Defining properties

Properties are defined as IRIs in your ontology file (`ontology/product.ttl`), then referenced in code via generated constants:

```typescript
import { nameIRI, priceIRI } from './product/types.generated.js';
```

Generated IRI constants are the only way properties are referenced in code — never construct IRI strings by hand in application logic.

### Entity record

An `EntityRecord` is the in-memory representation returned by `EntityStore`:

```typescript
interface EntityRecord {
    id:  string;   // UUID
    iri: IRI;      // full entity IRI
    // All property values are available as a flat map keyed by predicate IRI
}
```

---

## Extension Data — Arbitrary Subgraphs

Extensions add data to existing entities without modifying the base schema. The mechanism is a **named subgraph** scoped to the extension's namespace.

### Why named subgraphs

The base entity and each extension's data live in separate RDF graphs (the `G` in a quad). This means:
- Extensions never collide, even if two extensions add a property with the same local name.
- Removing an extension means dropping its named graphs — no surgery on shared data.
- Each extension's data can be queried, replicated, or authorised independently.

### Pattern

Given an entity IRI `http://example.com/ns/users/123`, an analytics extension writes into a graph named by combining the entity IRI and the extension namespace:

```
Graph: http://analytics.example.com/ext/users/123
```

All triples in that graph have the entity IRI as subject:

```turtle
GRAPH <http://analytics.example.com/ext/users/123> {
    <http://example.com/ns/users/123>
        analytics:lastActiveAt    "2024-06-01T12:00:00Z"^^xsd:dateTime ;
        analytics:sessionCount    "42"^^xsd:integer .
}
```

### In code

```typescript
import { extensionGraph } from '@jasonscharf/entities';
import { lastActiveAtIRI, sessionCountIRI } from './analytics/types.generated.js';

const ANALYTICS_NS = 'http://analytics.example.com/ext/';

// Write extension data
await store.writeExtension(ctx, entityIri, ANALYTICS_NS, [
    [lastActiveAtIRI,  Literal.dateTime(new Date())],
    [sessionCountIRI,  Literal.integer(42)],
]);

// Read extension data
const data = await store.readExtension(ctx, entityIri, ANALYTICS_NS, [
    lastActiveAtIRI,
    sessionCountIRI,
]);
// data → { [iri.value]: RDF Literal | IRI | undefined }
```

### Rules

- Extension data **must** live in a named graph scoped to the extension namespace and entity IRI.
- Extensions **must not** write into the base entity's graph.
- Extensions **must not** read from another extension's graph except through a published query API.
- Extension graphs are soft-deleted alongside the entity when the entity is deleted.

---

## The ServerContext

**Rule: every system-level function accepts `ctx` as its first parameter.**

`ServerContext` extends `ApplicationContext` with:

| Field | Type | Purpose |
|---|---|---|
| `logger?` | `Logger` | Structured logging |
| `events?` | `IDomainEventBus` | Event publishing/subscribing |
| `trx?` | `Knex.Transaction` | Current DB transaction (auto-set inside `inTransaction`) |
| `session?` | `UserSession` | Authenticated user session |
| `tenantId?` | `string` | Tenant graph scope |

```typescript
import { defaultServerContext } from '@jasonscharf/server';

const ctx: ServerContext = {
    ...defaultServerContext,
    logger:   myLogger,
    events:   eventBus,
    tenantId: 'tenant-abc',
};
```

Add application-specific fields via module augmentation:

```typescript
declare module '@jasonscharf/core' {
    interface ApplicationContext {
        myService?: MyService;
    }
}
```

---

## EntityStore

`EntityStore` is the primary data access object for all application code. It wraps `TripleStore` and handles entity creation, hydration, SHACL validation, collection views, and tenancy.

**Never access `TripleStore` directly in application code.** `TripleStore` is infrastructure; `EntityStore` is the domain layer.

### Create

```typescript
const product = await store.create(ctx, ProductSchema, {
    [nameIRI.value]:  Literal.string('Widget'),
    [priceIRI.value]: Literal.decimal(9.99),
});
// product.id → UUID; product.iri → full IRI
```

### Read

```typescript
const record = await store.findById(ctx, ProductSchema, id);
const many   = await store.hydrateMany(ctx, ProductSchema, iris);
```

### Update

```typescript
await store.update(ctx, ProductSchema, id, {
    [priceIRI.value]: Literal.decimal(14.99),
});
```

### Delete

Soft-delete by default — the entity's quads are timestamped and marked deleted, not physically removed. The historical record is always recoverable.

```typescript
await store.delete(ctx, ProductSchema, id);
```

### Query (fluent)

```typescript
import { entities } from '@jasonscharf/server';

const results = await entities(store, ProductSchema)
    .where(priceIRI, '>=', Literal.decimal(10))
    .orderBy(nameIRI, 'asc')
    .limit(20)
    .all(ctx);
```

### Transactions

```typescript
const { a, b } = await store.inTransaction(async (ctx) => {
    const a = await store.create(ctx, ProductSchema, { /* ... */ });
    const b = await store.create(ctx, ProductSchema, { /* ... */ });
    return { a, b };
});
```

The transaction `ctx` automatically propagates `trx` to all nested store operations. Do not pass `ctx` from outside the transaction callback into nested calls.

### Collections

An ordered list of entity IRIs or literals associated with an entity:

```typescript
await store.collectionPush(ctx, ProductSchema, id, 'tags', tagIri);
const tags = await store.collectionGet(ctx, ProductSchema, id, 'tags');
await store.collectionRemove(ctx, ProductSchema, id, 'tags', tagIri);
```

---

## The Event Bus

### Interface (in `@jasonscharf/core`)

```typescript
interface IDomainEventBus {
    publish<T>(event: DomainEvent<T>): Promise<void>;
    subscribe<T>(typeIri: string, subscriptionName: string, handler: (e: DomainEvent<T>) => Promise<void>): Promise<EventSubscription>;
    close(): Promise<void>;
}

interface DomainEvent<T> {
    id:        string;   // UUID v4
    type:      string;   // IRI naming the event type
    source:    string;   // IRI of the emitting component/aggregate
    timestamp: number;   // Unix epoch ms
    payload:   T;
}
```

### Implementations

| Class | Package | Use |
|---|---|---|
| `InMemoryEventBus` | `@jasonscharf/events` | Development, tests |
| `RedisStreamEventBus` | `@jasonscharf/events` | Production (distributed) |

### Delivery semantics

- **Same `subscriptionName`, multiple instances** → competing consumers; each message delivered to exactly one instance (load-balanced)
- **Different `subscriptionNames`** → fan-out; every subscription receives every message
- **Handler throws** → message stays pending and is re-delivered (at-least-once)
- **`publish()` never throws** due to a subscriber error

### Wiring

Set `ctx.events` at startup:

```typescript
import { RedisStreamEventBus } from '@jasonscharf/events';
import { Redis } from 'ioredis';

const bus = new RedisStreamEventBus(new Redis(), new Redis(), { streamPrefix: 'myapp:events:' });
const ctx: ServerContext = { ...defaultServerContext, events: bus };
```

### Publishing a domain event

```typescript
await ctx.events!.publish<{ productId: string }>({
    id:        crypto.randomUUID(),
    type:      'http://example.com/events/ProductCreated',
    source:    'http://example.com/ns/ProductService',
    timestamp: Date.now(),
    payload:   { productId: product.id },
});
```

### Subscribing

```typescript
await ctx.events!.subscribe<{ productId: string }>(
    'http://example.com/events/ProductCreated',
    'notifications.on-product-created',
    async (event) => {
        await sendSlackNotification(event.payload.productId);
    },
);
```

### Naming conventions

Event type IRIs follow the pattern: `http://{namespace}/events/{AggregateType}.{past-tense-verb}`  
Examples: `http://tern.dev/ns/auth/User.created`, `http://tern.dev/ns/rbac/Grant.revoked`

---

## Flow-Based Programming

System uses FBP for all IO, HTTP, WebSocket, and inter-component messaging. Components are black boxes that communicate only through ports.

### FlowComponent

```typescript
import { FlowComponent } from '@jasonscharf/flow';

class ProductIndexer extends FlowComponent {
    private _in  = this.addPort<ProductCreatedEvent>('in',  'in');
    private _out = this.addPort<IndexEntry>('out', 'out');

    protected override async onInit(): Promise<void> {
        this.on(this._in, async (event) => {
            const entry = await buildIndexEntry(event.productId);
            await this._out.put(entry);
        });
    }
}
```

### FlowApp

```typescript
import { FlowApp, HttpServer, HttpDecoder, HttpRouter, HttpEncoder } from '@jasonscharf/flow';

const app = new FlowApp({ mode: 'push' });

const http    = new HttpServer({ port: 8080, context: app.context });
const decoder = new HttpDecoder({ context: app.context });
const router  = new HttpRouter({ context: app.context });
const encoder = new HttpEncoder({ context: app.context });

app.connect(http.ports.get('out')!,    decoder.ports.get('in')!);
app.connect(decoder.ports.get('out')!, router.ports.get('in')!);
app.connect(router.ports.get('out')!,  encoder.ports.get('in')!);
app.connect(encoder.ports.get('out')!, http.ports.get('in')!);

await app.start();
```

### Key rules

- Components must be **stateless** with respect to message content. State (DB, caches) is accessed through `ctx`.
- Components must handle **back-pressure** — a slow downstream will block the port queue, which is intentional.
- Never call component methods directly from outside the component. Send a message through a port.

---

## Extensions

An extension packages a set of related functionality: entity schemas, handlers, permissions, and lifecycle hooks.

### TernExtension interface

```typescript
interface TernExtension {
    name:      string;                  // reverse-DNS, e.g. "com.example.products"
    version:   string;                  // semver
    requires?: TernRequirement[];       // declared dependencies

    install(ctx: ApplicationContext):    Promise<void>;  // required; must be idempotent
    uninstall?(ctx: ApplicationContext): Promise<void>;
    upgrade?(from: string, to: string, ctx: ApplicationContext): Promise<void>;
}
```

### install() rules

`install()` is called **on every boot**. It must be safe to call multiple times:

```typescript
async install(ctx: ApplicationContext): Promise<void> {
    // Seed permissions (use upsert semantics, not insert)
    await rbac.createPermission(ctx, { permissionKey: 'products:write' });

    // Register namespace in TripleStore (ensureNamespace is idempotent)
    await store.ensureNamespace(ctx, 'products', 'http://example.com/ns/products/');
}
```

Extensions **do not register PropGroups** or modify another package's entity schema. If an extension needs to associate data with an existing entity type, it writes into its own named subgraph (see [Extension Data](#extension-data--arbitrary-subgraphs)).

### Loading extensions via app.yaml

```yaml
name: my-app
version: 1.0.0
handlers:
    - type: http://example.com/commands/CreateProduct
      handler: ./handlers/createProduct.js
```

```typescript
const app = await TernApp.fromYAML('./config/app.yaml', { context: ctx });
await app.start();
```

### Extension registry

```typescript
import { ExtensionRegistry, ExtensionManager } from '@jasonscharf/server';

const registry = new ExtensionRegistry();
registry.register(ProductsExtension);
registry.register(BillingExtension);  // can declare requires: ['com.example.products']

const manager = new ExtensionManager(registry, store);
await manager.installAll(ctx);  // installs in dependency order
```

---

## Applications

An **application** is `core + extensions`. It assembles:

1. A `SecretsManager` (vaults)
2. A database connection (`createDataContext`)
3. A `TripleStore` + namespace registrations
4. A session store (Redis or memory)
5. Auth repositories and `AuthService`
6. `RbacService` with seeded roles
7. Domain extensions (via `installConvos`, custom `TernExtension.install()`, etc.)
8. A `TernApp` loaded from YAML (handler registry)
9. FBP pipelines (`FlowApp` with HTTP/WS components)

See `packages/sandbox-server/src/index.ts` for a complete reference implementation.

---

## Auth and RBAC

### Auth flow

```
User → GET /auth/login?provider=google
     → redirect to Google OAuth
     → GET /auth/callback?code=...&state=...
     → AuthService.handleCallback() → { user, session }
     → Set session cookie or return token
```

### Validating a session in a handler

```typescript
const session = await authService.validateSession(token);
if (!session) {
    return { ok: false, error: 'Unauthorized' };
}
const ctx: ServerContext = { ...baseCtx, session };
```

### Permission check

```typescript
// Throws RbacError if denied
await rbac.assert(ctx, { principal: ctx.session!.userIri, permission: 'products:write' });

// Boolean check
const allowed = await rbac.can(ctx, { principal: userIri, permission: 'products:read' });
```

### Tenant scope

All RBAC grants can optionally be scoped to a `ResourceNode` IRI. Permissions granted at a parent resource are inherited by all descendants.

```typescript
const root = await rbac.createResource(ctx, { resourceType: 'Workspace' });
await rbac.createGrant(ctx, { principalIri: userIri, roleIri: editorRole.iri, scopeIri: root.iri });
// User can act on root and all its children
```

---

## Secrets and Configuration

**Rule: secrets never enter `process.env` in cloud deployments.** Fetch directly from the vault.

```typescript
import { SecretsManager } from '@jasonscharf/vaults';

const secrets = SecretsManager.fromEnvironment();
// Uses Azure Key Vault when AZURE_KEY_VAULT_URI is set; env vars otherwise.

const dbPassword = await secrets.getRequired('DB_PASSWORD');
const dbHost     = await secrets.getWithDefault('DB_HOST', 'localhost');
```

Precedence: **Vault > process.env > hardcoded default**

Non-sensitive configuration (ports, feature flags) goes through `process.env` directly — typically injected via Kubernetes ConfigMap. Secrets (passwords, API keys) always go through the vault.

---

## Codegen from Ontologies

Every entity type has a corresponding OWL ontology file (`.ttl`). The `@jasonscharf/gen` CLI reads these and emits TypeScript types and runtime SHACL descriptors.

### Workflow

1. Write `ontology/my-extension.ttl` (OWL classes + properties)
2. Write `ontology/my-extension.shacl.ttl` (SHACL constraints, optional)
3. Write `tern-gen.json` in your package root
4. Run `yarn codegen` (or `tern-codegen --config tern-gen.json`)
5. Commit the generated `*.generated.ts` files

### tern-gen.json

```json
{
    "bases": [
        {
            "ontology":   "@jasonscharf/core/ontology/auth.ttl",
            "package":    "@jasonscharf/core",
            "importPath": "@jasonscharf/core"
        }
    ],
    "extensions":     ["./ontology/my-extension.ttl"],
    "shapes":         ["./ontology/my-extension.shacl.ttl"],
    "localNamespace": "http://example.com/ns/my-extension/",
    "out":            "./src/my-extension/types.generated.ts",
    "shapesOut":      "./src/my-extension/shapes.generated.ts"
}
```

### What gets generated

- **`types.generated.ts`** — TypeScript interfaces for each class; IRI constants (`nameIRI`, `priceIRI`, etc.) for every property
- **`shapes.generated.ts`** — Runtime `ShaclNodeShape` objects indexed by target class IRI; used by `EntityStore` for write-time validation

### Shipping ontology files

Every publishable package that defines ontology files **must** include them in its `package.json` `files` array:

```json
{ "files": ["dist", "ontology"] }
```

Downstream packages reference these files in their `tern-gen.json` `bases` array.

---

## Tenancy

Pass `tenantId` on `ctx` to scope all reads and writes to a named graph.

```typescript
const ctx: ServerContext = { ...baseCtx, tenantId: 'tenant-abc' };
const product = await store.create(ctx, ProductSchema, { /* ... */ });
// Written to graph: http://tern.dev/g/tenant-abc
```

Without `tenantId`, operations target the global graph. Most application code should always pass a `tenantId`. System-level bootstrapping code (migrations, seeding) runs without one.

---

## Testing Rules

These rules are non-negotiable:

1. **Write tests first.** No implementation code without a failing test.
2. **No mocks, ever.** Use real infrastructure — real PostgreSQL, real Redis, real HTTP servers. In-memory SQLite is acceptable for the SQLite test run only.
3. **All database tests run twice** — once against SQLite, once against PostgreSQL.
4. **Tests run in transactions.** Roll back at the end of each suite to reset state.
5. **100% code coverage.** Verify with `yarn test:coverage`.
6. **Integration tests, not unit tests.** Test the behaviour of a system through its public API, not the internals of a single function.
7. **All test methods are prefixed `test`** — e.g. `testCreateProduct`, not `shouldCreateProduct`.

```typescript
describe('ProductRepository', () => {
    let knex: Knex;
    let store: EntityStore;

    beforeAll(async () => {
        knex  = await createDataContext({ client: 'sqlite', filename: ':memory:' });
        store = new EntityStore(new TripleStore(knex));
    });

    afterAll(async () => { await knex.destroy(); });

    it('testCreateProduct', async () => {
        await knex.transaction(async (trx) => {
            const ctx = { ...defaultServerContext, trx };
            const product = await store.create(ctx, ProductSchema, {
                [nameIRI.value]:  Literal.string('Widget'),
                [priceIRI.value]: Literal.decimal(9.99),
            });
            expect(product.id).toBeTruthy();
            throw new Error('rollback');
        }).catch(() => {});
    });
});
```

---

## Style Rules

- **Braces always** on `if`/`else`/`for`/`while` — no one-liners
- **Trailing commas** everywhere applicable
- **Private members prefixed `_`** — e.g. `_inPort`, `_store`
- **No alignment whitespace** — do not add spaces to align on a vertical axis
- **`ctx` is always first** — every system-level function signature starts with `ctx: SomeContext`
- **No comments** unless the WHY is non-obvious (hidden constraint, surprising invariant, workaround)
- **No `any`** — use `unknown` at boundaries and narrow with type guards

---

## Complete Boot Sequence

The canonical startup order for a Tern application server:

```typescript
// 1. Secrets
const secrets = SecretsManager.fromEnvironment();

// 2. Database
const knex  = await createDataContext({ client: 'pg', /* ... */ });
const store = new TripleStore(knex);

// 3. Namespace registration
await store.ensureNamespace(ctx, 'tern',  'http://tern.dev/ns/');
await store.ensureNamespace(ctx, 'myapp', 'http://myapp.com/ns/');

// 4. Session store
const sessionStore = new RedisSessionStore(new Redis());

// 5. Auth repositories + service
const repos   = { userRepo, sessionRepo, deviceRepo, identRepo };
const authSvc = new AuthService({ providers: [...], sessionStore, repos });

// 6. RBAC
const rbac = new RbacService({ /* repos */ });
await seed(ctx, rbac);

// 7. Extensions
await installConvos(ctx, rbac);
await ProductsExtension.install(ctx);

// 8. App (handlers)
const app = await TernApp.fromYAML('./config/app.yaml', { context: ctx });

// 9. FBP pipelines
const flow = new FlowApp({ mode: 'push' });
const http = new HttpServer({ port: 8080, context: flow.context });
// ... wire components ...
await flow.start();

// 10. Graceful shutdown
process.on('SIGTERM', async () => {
    await flow.stop();
    await ctx.events?.close();
    await knex.destroy();
});
```
