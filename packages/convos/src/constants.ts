import { IRI, makeUri, NS_EXT } from "@jasonscharf/core";

export const CONVOS_NS = makeUri(NS_EXT, "convos");

export const RDF_TYPE = new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
export const XSD_NS = "http://www.w3.org/2001/XMLSchema#";
export const XSD_STRING = new IRI(`${XSD_NS}string`);
export const XSD_BOOLEAN = new IRI(`${XSD_NS}boolean`);
export const XSD_DATETIME = new IRI(`${XSD_NS}dateTime`);
export const XSD_INTEGER = new IRI(`${XSD_NS}integer`);

// ── Class IRIs ─────────────────────────────────────────────────────────────────

export const ConversationClassIRI = new IRI(makeUri(CONVOS_NS, "Conversation"));
export const MessageClassIRI = new IRI(makeUri(CONVOS_NS, "Message"));
export const MessageRevisionClassIRI = new IRI(makeUri(CONVOS_NS, "MessageRevision"));
export const DraftClassIRI = new IRI(makeUri(CONVOS_NS, "Draft"));
export const ParticipantClassIRI = new IRI(makeUri(CONVOS_NS, "Participant"));
export const InboxClassIRI = new IRI(makeUri(CONVOS_NS, "Inbox"));
export const InboxMembershipClassIRI = new IRI(makeUri(CONVOS_NS, "InboxMembership"));
export const NotificationClassIRI = new IRI(makeUri(CONVOS_NS, "Notification"));
export const ReadReceiptClassIRI = new IRI(makeUri(CONVOS_NS, "ReadReceipt"));

// ── Shared predicates ─────────────────────────────────────────────────────────

export const contentIRI = new IRI(makeUri(CONVOS_NS, "content"));
export const contentTypeIRI = new IRI(makeUri(CONVOS_NS, "contentType"));
export const roleIRI = new IRI(makeUri(CONVOS_NS, "role"));

// ── Conversation predicates ───────────────────────────────────────────────────

export const subjectIriIRI = new IRI(makeUri(CONVOS_NS, "subjectIri"));
export const titleIRI = new IRI(makeUri(CONVOS_NS, "title"));
export const statusIRI = new IRI(makeUri(CONVOS_NS, "status"));
export const assignedToIRI = new IRI(makeUri(CONVOS_NS, "assignedTo"));
export const convoCreatedByIRI = new IRI(makeUri(CONVOS_NS, "createdBy"));
export const convoInboxIRI = new IRI(makeUri(CONVOS_NS, "inbox"));

// ── Message predicates ────────────────────────────────────────────────────────

export const conversationRefIRI = new IRI(makeUri(CONVOS_NS, "conversation"));
export const replyToIRI = new IRI(makeUri(CONVOS_NS, "replyTo"));
export const authorIRI = new IRI(makeUri(CONVOS_NS, "author"));
export const isDeletedIRI = new IRI(makeUri(CONVOS_NS, "isDeleted"));
export const revisionCountIRI = new IRI(makeUri(CONVOS_NS, "revisionCount"));

// ── MessageRevision predicates ────────────────────────────────────────────────

export const messageRefIRI = new IRI(makeUri(CONVOS_NS, "messageRef"));
export const revisionIRI = new IRI(makeUri(CONVOS_NS, "revision"));
export const editedByIRI = new IRI(makeUri(CONVOS_NS, "editedBy"));
export const editedAtIRI = new IRI(makeUri(CONVOS_NS, "editedAt"));

// ── Participant predicates ────────────────────────────────────────────────────

export const participantUserIRI = new IRI(makeUri(CONVOS_NS, "participantUser"));
export const joinedAtIRI = new IRI(makeUri(CONVOS_NS, "joinedAt"));

// ── Inbox predicates ──────────────────────────────────────────────────────────

export const inboxNameIRI = new IRI(makeUri(CONVOS_NS, "inboxName"));
export const inboxCreatedByIRI = new IRI(makeUri(CONVOS_NS, "inboxCreatedBy"));

// ── InboxMembership predicates ────────────────────────────────────────────────

export const memberInboxIRI = new IRI(makeUri(CONVOS_NS, "memberInbox"));
export const memberUserIRI = new IRI(makeUri(CONVOS_NS, "memberUser"));
export const grantedAtIRI = new IRI(makeUri(CONVOS_NS, "grantedAt"));

// ── ReadReceipt predicates ────────────────────────────────────────────────────

export const receiptConversationIRI = new IRI(makeUri(CONVOS_NS, "receiptConversation"));
export const receiptUserIRI = new IRI(makeUri(CONVOS_NS, "receiptUser"));
export const lastReadMessageIRI = new IRI(makeUri(CONVOS_NS, "lastReadMessage"));
export const lastReadAtIRI = new IRI(makeUri(CONVOS_NS, "lastReadAt"));

// ── Notification predicates ───────────────────────────────────────────────────

export const notifUserIRI = new IRI(makeUri(CONVOS_NS, "notifUser"));
export const notifTypeIRI = new IRI(makeUri(CONVOS_NS, "notifType"));
export const sourceIriIRI = new IRI(makeUri(CONVOS_NS, "sourceIri"));
export const isReadIRI = new IRI(makeUri(CONVOS_NS, "isRead"));
export const isDismissedIRI = new IRI(makeUri(CONVOS_NS, "isDismissed"));
/**
 * Stable string key identifying the notification template — e.g.
 * "insights:welcome" or "insights:daily-digest".  Used for deduplication.
 */
export const templateKeyIRI = new IRI(makeUri(CONVOS_NS, "templateKey"));
/** JSON-encoded arbitrary payload for rendering the notification. */
export const payloadIRI = new IRI(makeUri(CONVOS_NS, "payload"));
