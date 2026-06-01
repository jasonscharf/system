export type ConversationStatus = "open" | "closed" | "archived";
export type ParticipantRole = "owner" | "member" | "viewer";
export type InboxRole = "owner" | "member" | "viewer";
export type NotificationType = "reply" | "mention" | "assign" | "reaction" | "digest" | "insight";
export type ContentType = "text/markdown" | "text/plain";

export interface ConversationEntity {
    id: string;
    iri: string;
    /** IRI of the attached business object — any domain, any type. */
    subjectIri: string;
    inboxId: string | null;
    title: string;
    status: ConversationStatus;
    assignedTo: string | null;
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface MessageEntity {
    id: string;
    iri: string;
    conversationId: string;
    replyToId: string | null;
    authorId: string;
    content: string;
    contentType: ContentType;
    isDeleted: boolean;
    revisionCount: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface MessageRevisionEntity {
    id: string;
    iri: string;
    messageId: string;
    content: string;
    revision: number;
    editedBy: string;
    editedAt: Date;
}

export interface DraftEntity {
    id: string;
    iri: string;
    conversationId: string;
    authorId: string;
    replyToId: string | null;
    content: string;
    contentType: ContentType;
    createdAt: Date;
    updatedAt: Date;
}

export interface ParticipantEntity {
    id: string;
    iri: string;
    conversationId: string;
    userId: string;
    role: ParticipantRole;
    joinedAt: Date;
}

export interface InboxEntity {
    id: string;
    iri: string;
    /** IRI of the attached business object — any domain, any type. */
    subjectIri: string;
    name: string;
    createdBy: string;
    createdAt: Date;
}

export interface InboxMembershipEntity {
    id: string;
    iri: string;
    inboxId: string;
    userId: string;
    role: InboxRole;
    grantedAt: Date;
}

/**
 * Tracks the furthest message a user has explicitly read in a conversation.
 * Used to drive unread counts and to suppress duplicate notifications.
 */
export interface ReadReceiptEntity {
    id: string;
    iri: string;
    conversationId: string;
    userId: string;
    /** IRI of the last message the user acknowledged reading. */
    lastReadMessageId: string;
    lastReadAt: Date;
}

export interface NotificationEntity {
    id: string;
    iri: string;
    userId: string;
    notifType: NotificationType;
    /**
     * IRI of the resource that triggered this notification (conversation,
     * message, or any domain object).  Undefined for programmatic insights
     * that are not tied to a specific resource.
     */
    sourceIri: string | undefined;
    /**
     * Stable string key identifying the notification template.
     * Set by NotificationService; absent for conversation fan-out notifications.
     */
    templateKey: string | undefined;
    /** JSON-encoded arbitrary data for rendering the notification. */
    payload: string | undefined;
    isRead: boolean;
    isDismissed: boolean;
    createdAt: Date;
}

// ── Programmatic notification types ──────────────────────────────────────────

/**
 * How the deduplication check behaves for a given template.
 *
 * - `one-time`   — at most one delivery ever; dismissing does NOT reset it.
 * - `resettable` — like one-time, but dismissing resets the latch so the next
 *                  call to send() will deliver again.  Useful for "show me
 *                  again later" patterns.
 * - `window`     — at most once per `hours` hours; dismissing always resets.
 */
export type DedupePolicy =
    | { kind: "one-time" }
    | { kind: "resettable" }
    | { kind: "window"; hours: number };

export interface SendNotificationInput {
    userId: string;
    notifType?: NotificationType;
    /**
     * Stable key for this notification template.
     * The same key across multiple `send()` calls is what drives deduplication.
     */
    templateKey: string;
    /** Optional IRI link to the resource that triggered the notification. */
    sourceIri?: string;
    /** Arbitrary data that the notification renderer can use. */
    payload?: Record<string, unknown>;
    dedupe: DedupePolicy;
}
