import { IRI } from "@jasonscharf/core";

export const CONVOS_NS = "http://tern.dev/ns/convos/";
export const CONVOS_GRAPH = new IRI(`${CONVOS_NS}graph`);

export const RDF_TYPE = new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
export const XSD_NS = "http://www.w3.org/2001/XMLSchema#";
export const XSD_STRING = new IRI(`${XSD_NS}string`);
export const XSD_BOOLEAN = new IRI(`${XSD_NS}boolean`);
export const XSD_DATETIME = new IRI(`${XSD_NS}dateTime`);
export const XSD_INTEGER = new IRI(`${XSD_NS}integer`);

// ── Class IRIs ─────────────────────────────────────────────────────────────────

export const ConversationClassIRI = new IRI(`${CONVOS_NS}Conversation`);
export const MessageClassIRI = new IRI(`${CONVOS_NS}Message`);
export const MessageRevisionClassIRI = new IRI(`${CONVOS_NS}MessageRevision`);
export const DraftClassIRI = new IRI(`${CONVOS_NS}Draft`);
export const ParticipantClassIRI = new IRI(`${CONVOS_NS}Participant`);
export const InboxClassIRI = new IRI(`${CONVOS_NS}Inbox`);
export const InboxMembershipClassIRI = new IRI(`${CONVOS_NS}InboxMembership`);
export const NotificationClassIRI = new IRI(`${CONVOS_NS}Notification`);
export const ReadReceiptClassIRI = new IRI(`${CONVOS_NS}ReadReceipt`);

// ── Shared predicates ─────────────────────────────────────────────────────────

export const convosCreatedAtIRI = new IRI(`${CONVOS_NS}createdAt`);
export const convosUpdatedAtIRI = new IRI(`${CONVOS_NS}updatedAt`);
export const contentIRI = new IRI(`${CONVOS_NS}content`);
export const contentTypeIRI = new IRI(`${CONVOS_NS}contentType`);
export const roleIRI = new IRI(`${CONVOS_NS}role`);

// ── Conversation predicates ───────────────────────────────────────────────────

export const subjectIriIRI = new IRI(`${CONVOS_NS}subjectIri`);
export const titleIRI = new IRI(`${CONVOS_NS}title`);
export const statusIRI = new IRI(`${CONVOS_NS}status`);
export const assignedToIRI = new IRI(`${CONVOS_NS}assignedTo`);
export const convoCreatedByIRI = new IRI(`${CONVOS_NS}createdBy`);
export const convoInboxIRI = new IRI(`${CONVOS_NS}inbox`);

// ── Message predicates ────────────────────────────────────────────────────────

export const conversationRefIRI = new IRI(`${CONVOS_NS}conversation`);
export const replyToIRI = new IRI(`${CONVOS_NS}replyTo`);
export const authorIRI = new IRI(`${CONVOS_NS}author`);
export const isDeletedIRI = new IRI(`${CONVOS_NS}isDeleted`);
export const revisionCountIRI = new IRI(`${CONVOS_NS}revisionCount`);

// ── MessageRevision predicates ────────────────────────────────────────────────

export const messageRefIRI = new IRI(`${CONVOS_NS}messageRef`);
export const revisionIRI = new IRI(`${CONVOS_NS}revision`);
export const editedByIRI = new IRI(`${CONVOS_NS}editedBy`);
export const editedAtIRI = new IRI(`${CONVOS_NS}editedAt`);

// ── Participant predicates ────────────────────────────────────────────────────

export const participantUserIRI = new IRI(`${CONVOS_NS}participantUser`);
export const joinedAtIRI = new IRI(`${CONVOS_NS}joinedAt`);

// ── Inbox predicates ──────────────────────────────────────────────────────────

export const inboxNameIRI = new IRI(`${CONVOS_NS}inboxName`);
export const inboxCreatedByIRI = new IRI(`${CONVOS_NS}inboxCreatedBy`);

// ── InboxMembership predicates ────────────────────────────────────────────────

export const memberInboxIRI = new IRI(`${CONVOS_NS}memberInbox`);
export const memberUserIRI = new IRI(`${CONVOS_NS}memberUser`);
export const grantedAtIRI = new IRI(`${CONVOS_NS}grantedAt`);

// ── ReadReceipt predicates ────────────────────────────────────────────────────

export const receiptConversationIRI = new IRI(`${CONVOS_NS}receiptConversation`);
export const receiptUserIRI = new IRI(`${CONVOS_NS}receiptUser`);
export const lastReadMessageIRI = new IRI(`${CONVOS_NS}lastReadMessage`);
export const lastReadAtIRI = new IRI(`${CONVOS_NS}lastReadAt`);

// ── Notification predicates ───────────────────────────────────────────────────

export const notifUserIRI = new IRI(`${CONVOS_NS}notifUser`);
export const notifTypeIRI = new IRI(`${CONVOS_NS}notifType`);
export const sourceIriIRI = new IRI(`${CONVOS_NS}sourceIri`);
export const isReadIRI = new IRI(`${CONVOS_NS}isRead`);
export const isDismissedIRI = new IRI(`${CONVOS_NS}isDismissed`);
/**
 * Stable string key identifying the notification template — e.g.
 * "insights:welcome" or "insights:daily-digest".  Used for deduplication.
 */
export const templateKeyIRI = new IRI(`${CONVOS_NS}templateKey`);
/** JSON-encoded arbitrary payload for rendering the notification. */
export const payloadIRI = new IRI(`${CONVOS_NS}payload`);
