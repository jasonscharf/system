# @jasonscharf/server

Entity storage, querying, and extension management for the Tern platform. The primary data access layer for application code.

## ServerContext

`ServerContext` extends `ApplicationContext` with database transaction, session, and tenancy fields.

```typescript
import type { ServerContext } from '@jasonscharf/server';
import { defaultServerContext } from '@jasonscharf/server';

const ctx: ServerContext = {
    ...defaultServerContext,
    logger:   myLogger,
    events:   eventBus,
    trx:      knexTransaction,   // optional; auto-managed by inTransaction()
    session:  userSession,       // optional; set after auth
    tenantId: 'tenant-abc',      // optional; scopes reads/writes to tenant graph
};
```

## EntityStore

The main data access object. All entity reads and writes go through here — never access `TripleStore` directly in application code.

```typescript
import { EntityStore } from '@jasonscharf/server';
import { TripleStore } from '@jasonscharf/data';

const store = new EntityStore(new TripleStore(knex));
```

### Create

```typescript
import { nameIRI, priceIRI } from './product/types.generated.js';

const product = await store.create(ctx, ProductSchema, {
    [nameIRI.value]:  Literal.string('Widget'),
    [priceIRI.value]: Literal.decimal(9.99),
});
// product.id → UUID; product.iri → full IRI
```

### Read

```typescript
const record = await store.findById(ctx, ProductSchema, productId);
const many   = await store.hydrateMany(ctx, ProductSchema, iris);
```

### Update

```typescript
await store.update(ctx, ProductSchema, productId, {
    [priceIRI.value]: Literal.decimal(14.99),
});
```

### Delete

Soft-delete — the entity's quads are timestamped and marked deleted, not physically removed. The historical record is always recoverable.

```typescript
await store.delete(ctx, ProductSchema, productId);
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

## EntityQuery

Fluent query builder for filtering and sorting entities.

```typescript
import { entities } from '@jasonscharf/server';

const results = await entities(store, ProductSchema)
    .where(priceIRI, '>=', Literal.decimal(10))
    .orderBy(nameIRI, 'asc')
    .limit(20)
    .offset(0)
    .all(ctx);

const first = await entities(store, ProductSchema)
    .where(nameIRI, '=', Literal.string('Widget'))
    .first(ctx);
```

## Extension Data

Extensions associate their own data with existing entities by writing into a named subgraph scoped to the extension's namespace. `EntityStore` exposes `writeExtension` and `readExtension` for this:

```typescript
const ANALYTICS_NS = 'http://analytics.example.com/ext/';

await store.writeExtension(ctx, userIri, ANALYTICS_NS, [
    [lastActiveAtIRI, Literal.dateTime(new Date())],
]);

const data = await store.readExtension(ctx, userIri, ANALYTICS_NS, [lastActiveAtIRI]);
```

Extension graphs are soft-deleted alongside the entity and never overlap with the base entity's graph or another extension's graph.

## Collections

Ordered lists of IRIs or literals associated with an entity:

```typescript
await store.collectionPush(ctx, ProductSchema, id, 'tags', tagIri);
const tags = await store.collectionGet(ctx, ProductSchema, id, 'tags');
await store.collectionRemove(ctx, ProductSchema, id, 'tags', tagIri);
await store.collectionInsertAt(ctx, ProductSchema, id, 'tags', tagIri, 0);
```

## Collection Views

Sorted, filtered windows over a collection. Managed via `store.views`.

```typescript
const view = await store.createCollectionView(ctx, ProductSchema, id, 'tags', {
    sortProp: nameIRI,
    sortDir:  'asc',
});
```

## ExtensionRegistry and ExtensionManager

Track and drive the lifecycle of installed extensions.

```typescript
import { ExtensionRegistry, ExtensionManager } from '@jasonscharf/server';

const registry = new ExtensionRegistry();
const manager  = new ExtensionManager(registry, store);

registry.register(myExtension);
await manager.installAll(ctx);
```

## Tenancy

Pass `tenantId` on `ctx` to scope all reads and writes to a tenant's named graph. Without `tenantId`, operations target the global graph.

```typescript
const ctx: ServerContext = { ...defaultServerContext, tenantId: 'tenant-abc' };
const record = await store.create(ctx, ProductSchema, { /* ... */ });
// Written to graph http://tern.dev/g/tenant-abc
```

## Installation

```bash
yarn add @jasonscharf/server
yarn add knex better-sqlite3   # or: knex pg
```

Published to GitHub Packages (`https://npm.pkg.github.com`).
