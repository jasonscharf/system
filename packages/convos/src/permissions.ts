/**
 * RBAC permission keys for the convos extension.
 *
 * Keys follow the Tern convention: `tern.convos:<domain>.<action>[.<qualifier>]`
 * Seed these with installConvos() at startup. Scope a check to a conversation
 * IRI to enforce per-conversation access.
 */

// ── Conversation permissions ──────────────────────────────────────────────────

/** Start a new conversation on any subject IRI. */
export const PERM_CONVO_CREATE = "tern.convos:conversation.create";

/** View conversations and their messages. */
export const PERM_CONVO_READ = "tern.convos:conversation.read";

/** Close an open conversation. */
export const PERM_CONVO_CLOSE = "tern.convos:conversation.close";

/** Archive a conversation. */
export const PERM_CONVO_ARCHIVE = "tern.convos:conversation.archive";

/** Assign a conversation to a user. */
export const PERM_CONVO_ASSIGN = "tern.convos:conversation.assign";

// ── Message permissions ───────────────────────────────────────────────────────

/** Post a new message to a conversation. */
export const PERM_MESSAGE_POST = "tern.convos:message.post";

/** Edit your own messages. */
export const PERM_MESSAGE_EDIT_OWN = "tern.convos:message.edit.own";

/** Edit any message — moderator privilege. */
export const PERM_MESSAGE_EDIT_ANY = "tern.convos:message.edit.any";

/** Soft-delete your own messages. */
export const PERM_MESSAGE_DELETE_OWN = "tern.convos:message.delete.own";

/** Soft-delete any message — moderator privilege. */
export const PERM_MESSAGE_DELETE_ANY = "tern.convos:message.delete.any";

// ── Participant permissions ───────────────────────────────────────────────────

/** Add or remove participants from a conversation. */
export const PERM_PARTICIPANT_MANAGE = "tern.convos:participant.manage";

// ── Inbox permissions ─────────────────────────────────────────────────────────

/** Create a shared inbox on any subject. */
export const PERM_INBOX_CREATE = "tern.convos:inbox.create";

/** Grant or revoke inbox membership. */
export const PERM_INBOX_MANAGE = "tern.convos:inbox.manage";

// ── All keys (for seeding) ────────────────────────────────────────────────────

export const ALL_CONVOS_PERMISSIONS = [
    PERM_CONVO_CREATE,
    PERM_CONVO_READ,
    PERM_CONVO_CLOSE,
    PERM_CONVO_ARCHIVE,
    PERM_CONVO_ASSIGN,
    PERM_MESSAGE_POST,
    PERM_MESSAGE_EDIT_OWN,
    PERM_MESSAGE_EDIT_ANY,
    PERM_MESSAGE_DELETE_OWN,
    PERM_MESSAGE_DELETE_ANY,
    PERM_PARTICIPANT_MANAGE,
    PERM_INBOX_CREATE,
    PERM_INBOX_MANAGE,
] as const;

/** Permissions that make up the built-in "ConvoUser" role. */
export const CONVO_USER_PERMISSIONS = [
    PERM_CONVO_CREATE,
    PERM_CONVO_READ,
    PERM_MESSAGE_POST,
    PERM_MESSAGE_EDIT_OWN,
    PERM_MESSAGE_DELETE_OWN,
] as const;

/** Permissions that make up the built-in "ConvoModerator" role (superset of ConvoUser). */
export const CONVO_MODERATOR_PERMISSIONS = [
    ...CONVO_USER_PERMISSIONS,
    PERM_CONVO_CLOSE,
    PERM_CONVO_ARCHIVE,
    PERM_CONVO_ASSIGN,
    PERM_MESSAGE_EDIT_ANY,
    PERM_MESSAGE_DELETE_ANY,
    PERM_PARTICIPANT_MANAGE,
    PERM_INBOX_CREATE,
    PERM_INBOX_MANAGE,
] as const;
