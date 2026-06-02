# @jasonscharf/convos

Conversations, messaging, and notifications extension for the Tern platform. Provides discussion threads, participant management, inboxes, and notification delivery.

## Installation (Extension Lifecycle)

Call `installConvos` once at application startup. It is idempotent and seeds the required RBAC roles and permissions.

```typescript
import { installConvos } from '@jasonscharf/convos';

const result = await installConvos(ctx, rbacService);
// result.userRoleIri, result.moderatorRoleIri, etc.
```

## ConvoService

```typescript
import {
    ConvoService,
    ConversationRepository,
    MessageRepository,
    ParticipantRepository,
    InboxRepository,
} from '@jasonscharf/convos';
import { EntityStore } from '@jasonscharf/server';

const store = new EntityStore(/* knex */);

const service = new ConvoService({
    store,
    convos:       new ConversationRepository(store),
    messages:     new MessageRepository(store),
    participants: new ParticipantRepository(store),
    inboxes:      new InboxRepository(store),
    rbac:         rbacService,
});

// Create a conversation
const convo = await service.createConversation(ctx, {
    title:       'Q3 Planning',
    creatorIri:  userIri,
    tenantIri:   tenantIri,
});

// Post a message
const msg = await service.sendMessage(ctx, {
    conversationIri: convo.iri,
    authorIri:       userIri,
    body:            'Hello!',
    contentType:     'text/plain',
});

// List messages in a conversation
const messages = await service.listMessages(ctx, convo.iri);

// Archive a conversation
await service.archiveConversation(ctx, convo.iri);
```

## NotificationService

```typescript
import { NotificationService, NotificationRepository } from '@jasonscharf/convos';

const notifications = new NotificationService({
    store,
    repo:  new NotificationRepository(store),
    rbac:  rbacService,
});

await notifications.send(ctx, {
    recipientIri: userIri,
    type:         'message.received',
    payload:      { conversationIri: convo.iri, messageIri: msg.iri },
});

const unread = await notifications.listUnread(ctx, userIri);
await notifications.markRead(ctx, notificationIri);
```

## Permissions and Roles

Convos installs its own RBAC roles on first run. Use the exported permission constants to guard your own handlers.

```typescript
import {
    PERM_CONVO_CREATE,
    PERM_CONVO_READ,
    PERM_CONVO_ARCHIVE,
    PERM_CONVO_CLOSE,
    CONVO_USER_PERMISSIONS,
    CONVO_MODERATOR_PERMISSIONS,
    CONVO_USER_ROLE_NAME,
    CONVO_MODERATOR_ROLE_NAME,
} from '@jasonscharf/convos';

await rbac.assert(ctx, { principal: userIri, permission: PERM_CONVO_CREATE });
```

## Entity Types

```typescript
import type {
    ConversationEntity,
    MessageEntity,
    ParticipantEntity,
    InboxEntity,
    NotificationEntity,
    ConversationStatus,   // 'open' | 'archived' | 'closed'
    ParticipantRole,      // 'member' | 'moderator'
    ContentType,          // 'text/plain' | 'text/markdown'
} from '@jasonscharf/convos';
```

## Installation

```bash
yarn add @jasonscharf/convos
```

Published to GitHub Packages (`https://npm.pkg.github.com`).
