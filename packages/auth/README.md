# @jasonscharf/auth

OAuth-based authentication for the Tern platform. Manages users, sessions, devices, and OAuth identities as RDF-native entities.

## Entity Schemas

The package exports pre-built `EntitySchema` instances for all auth entity types.

```typescript
import { UserSchema, UserSessionSchema, UserDeviceSchema, UserIdentitySchema } from '@jasonscharf/auth';
```

These schemas are registered at import time. Downstream packages extend user data by writing extension subgraphs — they do not modify `UserSchema` directly.

## Repositories

Each entity type has a typed repository wrapping `EntityStore`.

```typescript
import {
    UserRepository,
    UserSessionRepository,
    UserDeviceRepository,
    UserIdentityRepository,
} from '@jasonscharf/auth';
import { EntityStore } from '@jasonscharf/server';

const store = new EntityStore(/* knex */);

const userRepo    = new UserRepository(store);
const sessionRepo = new UserSessionRepository(store);
const deviceRepo  = new UserDeviceRepository(store);
const identRepo   = new UserIdentityRepository(store);
```

## AuthService

High-level service for the full OAuth flow.

```typescript
import { AuthService, GoogleProvider, GitHubProvider, MemorySessionStore } from '@jasonscharf/auth';

const auth = new AuthService({
    providers: [
        new GoogleProvider({ clientId: '...', clientSecret: '...' }),
        new GitHubProvider({ clientId: '...', clientSecret: '...' }),
    ],
    sessionStore: new MemorySessionStore(),
    repos: { userRepo, sessionRepo, deviceRepo, identRepo },
});

// Build redirect URL for OAuth login
const { url, state } = await auth.buildAuthUrl('google', 'https://myapp.com/auth/callback');

// Handle OAuth callback
const { user, session } = await auth.handleCallback({
    provider:    'google',
    code:        req.query.code,
    state:       req.query.state,
    redirectUri: 'https://myapp.com/auth/callback',
});

// Validate a session token
const sess = await auth.validateSession(token);
if (!sess) { /* reject */ }

// Revoke a session
await auth.revokeSession(ctx, sessionId);
```

## Session Stores

```typescript
import { MemorySessionStore, RedisSessionStore } from '@jasonscharf/auth';
import { Redis } from 'ioredis';

const sessionStore = new MemorySessionStore();                // development / tests
const sessionStore = new RedisSessionStore(new Redis(url));  // production
```

## AuthRouterComponent (FBP)

Drop-in FBP component for HTTP OAuth routes (`/auth/login`, `/auth/callback`, `/auth/logout`).

```typescript
import { AuthRouterComponent } from '@jasonscharf/auth';

const authRouter = new AuthRouterComponent({
    providers:    [new GoogleProvider({ clientId: '...', clientSecret: '...' })],
    sessionStore,
    repos:        { userRepo, sessionRepo, deviceRepo, identRepo },
    baseUrl:      'https://myapp.com',
    loginSuccess: (ctx, session) => { ctx.redirect('/dashboard'); },
    loginFailure: (ctx, err)     => { ctx.status = 401; },
});
```

## Adding Data to Users from an Extension

Extensions that need to store extra data per-user write into a named subgraph owned by that extension — not by modifying `UserSchema`:

```typescript
import { UserSchema } from '@jasonscharf/auth';
import { EntityStore } from '@jasonscharf/server';

const MY_NS = 'http://myapp.com/ext/profile/';

// In your extension's handler or service:
await store.writeExtension(ctx, userIri, MY_NS, [
    [bioIRI,       Literal.string('Engineer at Acme')],
    [avatarUrlIRI, Literal.string('https://...')],
]);
```

## Ontology

Auth ontology files (`auth.ttl`, `auth.shacl.ttl`) ship with `@jasonscharf/core` under `ontology/`. Reference them as a `base` in your `tern-gen.json` when defining properties that relate to auth classes.

## Installation

```bash
yarn add @jasonscharf/auth
```

Published to GitHub Packages (`https://npm.pkg.github.com`).
