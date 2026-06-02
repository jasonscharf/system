# @jasonscharf/app

Application assembly for the Tern platform. Loads handler registries from YAML config and provides the `TernExtension` lifecycle contract.

## TernApp

`TernApp` is the top-level application object. It ties together a handler registry and a `FlowApp` FBP runtime.

```typescript
import { TernApp } from '@jasonscharf/app';

const ternApp = await TernApp.fromYAML('./config/app.yaml', { context: ctx });

await ternApp.start();
// ...
await ternApp.stop();
```

### app.yaml

```yaml
name: my-app
version: 1.0.0
handlers:
    - type: http://example.com/commands/CreateProduct
      handler: ./handlers/createProduct.js
    - type: http://example.com/queries/ListProducts
      handler: ./handlers/listProducts.js
```

### Loading from entries directly

```typescript
const ternApp = await TernApp.fromEntries(config, [
    { type: new IRI('http://example.com/commands/CreateProduct'), handler: createProductHandler },
    { type: new IRI('http://example.com/queries/ListProducts'),   handler: listProductsHandler },
]);
```

## HandlerFn

A handler is an async function that receives typed input and a context:

```typescript
import type { HandlerFn, HandlerContext } from '@jasonscharf/app';
import { nameIRI, priceIRI } from './product/types.generated.js';

const createProductHandler: HandlerFn = async (input, context) => {
    const { name, price } = input as { name: string; price: number };
    const product = await store.create(context, ProductSchema, {
        [nameIRI.value]:  Literal.string(name),
        [priceIRI.value]: Literal.decimal(price),
    });
    return { id: product.id };
};
```

## TernExtension

Extensions are the primary mechanism for packaging reusable functionality. Implement `TernExtension` to participate in the application lifecycle.

```typescript
import type { TernExtension } from '@jasonscharf/app';
import type { ApplicationContext } from '@jasonscharf/core';

export const MyExtension: TernExtension = {
    name:    'com.example.my-extension',
    version: '1.0.0',

    requires: [
        { extension: 'com.example.auth', minVersion: '1.0.0' },
    ],

    async install(ctx: ApplicationContext): Promise<void> {
        // Register namespaces, seed permissions.
        // MUST be idempotent — called on every boot.
        await store.ensureNamespace(ctx, 'myext', 'http://example.com/ns/myext/');
        await seedPermissions(ctx);

        // Extensions do NOT modify other packages' entity schemas.
        // If you need to associate data with an existing entity type,
        // write into a named subgraph (see @jasonscharf/server writeExtension).
    },

    async uninstall(ctx: ApplicationContext): Promise<void> {
        // Optional. Clean up extension data.
    },

    async upgrade(from: string, to: string, ctx: ApplicationContext): Promise<void> {
        // Optional. Migrate data from version `from` to version `to`.
    },
};
```

Extension hooks are always **idempotent** — the platform may call `install` on every boot.

## HandlerRegistry

Maps message type IRIs to their handler implementations.

```typescript
import { HandlerRegistry } from '@jasonscharf/app';

const registry = new HandlerRegistry();
registry.register([
    { type: new IRI('http://example.com/commands/CreateProduct'), handler: createProductHandler },
]);

const result = await registry.dispatch(
    new IRI('http://example.com/commands/CreateProduct'),
    payload,
    context,
);
```

## Installation

```bash
yarn add @jasonscharf/app
```

Published to GitHub Packages (`https://npm.pkg.github.com`).
