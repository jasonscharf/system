# @jasonscharf/events

Event bus implementations for the Tern platform. Provides `InMemoryEventBus` for development/testing and `RedisStreamEventBus` for distributed production deployments.

The `IDomainEventBus` interface lives in `@jasonscharf/core` and is what all platform code depends on. This package provides the concrete implementations.

## InMemoryEventBus

Single-process, synchronous delivery. Use in development and tests.

```typescript
import { InMemoryEventBus } from '@jasonscharf/events';
import type { DomainEvent } from '@jasonscharf/core';

const bus = new InMemoryEventBus();

// Subscribe — subscriptionName must be globally unique per event type.
await bus.subscribe<{ userId: string }>(
    'http://tern.dev/ns/auth/user.created',
    'my-extension.on-user-created',
    async (event: DomainEvent<{ userId: string }>) => {
        console.log('new user:', event.payload.userId);
    },
);

// Publish
await bus.publish<{ userId: string }>({
    id:        crypto.randomUUID(),
    type:      'http://tern.dev/ns/auth/user.created',
    source:    'http://tern.dev/ns/auth',
    timestamp: Date.now(),
    payload:   { userId: 'u-123' },
});

// Clean up
await bus.close();
```

## RedisStreamEventBus

Distributed, at-least-once delivery via Redis Streams and consumer groups. Use in production.

```typescript
import { RedisStreamEventBus } from '@jasonscharf/events';
import { Redis } from 'ioredis';

const publisher = new Redis();
const subscriber = new Redis();

const bus = new RedisStreamEventBus(publisher, subscriber, {
    streamPrefix:   'myapp:events:',   // prevents collisions with other apps
    claimMinIdleMs: 30_000,            // re-claim after 30 s idle
});

await bus.subscribe<{ userId: string }>(
    'http://tern.dev/ns/auth/user.created',
    'notifications.on-user-created',   // all instances sharing this name compete for each message
    async (event) => { /* ... */ },
);

await bus.close();
```

## Delivery Semantics

| Scenario | Behaviour |
|---|---|
| Same `subscriptionName`, multiple instances | Load-balanced — each message delivered to exactly one instance |
| Different `subscriptionNames` | Fan-out — each name independently receives every message |
| Handler throws | Message stays pending; re-delivered after `claimMinIdleMs` |
| Subscriber errors | Never propagate through `publish()` |

## Wiring into ApplicationContext

The event bus should be set on `ctx.events` at startup so all platform code can use it without a direct dependency on this package.

```typescript
import { InMemoryEventBus } from '@jasonscharf/events';

const ctx = {
    ...defaultCtx,
    events: new InMemoryEventBus(),
};
```

## Installation

```bash
yarn add @jasonscharf/events
# Production:
yarn add ioredis
```

Published to GitHub Packages (`https://npm.pkg.github.com`).
