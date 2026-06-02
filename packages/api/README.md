# @jasonscharf/api

Minimal HTTP health-check and version endpoint for Tern applications. Exposes `GET /` and `GET /version` over a Koa server.

## Endpoints

| Method | Path | Response |
|---|---|---|
| `GET` | `/` | `{ ok: true, server: "tern-api" }` |
| `GET` | `/version` | Contents of `version.json` |
| `*` | `*` | `404` |

## Usage

```typescript
import { createApiServer } from '@jasonscharf/api';

const server = createApiServer({ port: 3000 });
await server.start();
```

This package is a thin integration aid. For full application HTTP routing, use `@jasonscharf/flow` (`HttpServer`, `HttpRouter`) or Koa directly.

## Installation

```bash
yarn add @jasonscharf/api
```

Published to GitHub Packages (`https://npm.pkg.github.com`).
