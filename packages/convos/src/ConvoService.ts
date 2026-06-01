import type { RbacService } from "@jasonscharf/rbac";
import type { ServerContext } from "@jasonscharf/server";
import {
    PERM_CONVO_ARCHIVE,
    PERM_CONVO_ASSIGN,
    PERM_CONVO_CLOSE,
    PERM_CONVO_CREATE,
    PERM_INBOX_CREATE,
    PERM_INBOX_MANAGE,
    PERM_MESSAGE_DELETE_ANY,
    PERM_MESSAGE_DELETE_OWN,
    PERM_MESSAGE_EDIT_ANY,
    PERM_MESSAGE_EDIT_OWN,
    PERM_MESSAGE_POST,
    PERM_PARTICIPANT_MANAGE,
} from "./permissions.js";
import type { ConversationRepository } from "./repository/ConversationRepository.js";
import type { DraftRepository } from "./repository/DraftRepository.js";
import type { InboxRepository } from "./repository/InboxRepository.js";
import type { MessageRepository } from "./repository/MessageRepository.js";
import type { NotificationRepository } from "./repository/NotificationRepository.js";
import type { ParticipantRepository } from "./repository/ParticipantRepository.js";
import type { ReadReceiptRepository } from "./repository/ReadReceiptRepository.js";
import type {
    ContentType,
    ConversationEntity,
    ConversationStatus,
    DraftEntity,
    InboxEntity,
    InboxMembershipEntity,
    InboxRole,
    MessageEntity,
    MessageRevisionEntity,
    NotificationEntity,
    ParticipantEntity,
    ParticipantRole,
    ReadReceiptEntity,
} from "./types.js";

export interface ConvoServiceOptions {
    conversations: ConversationRepository;
    messages: MessageRepository;
    participants: ParticipantRepository;
    drafts: DraftRepository;
    inboxes: InboxRepository;
    notifications: NotificationRepository;
    receipts: ReadReceiptRepository;
    rbac?: RbacService;
}

export class ConvoService {
    private readonly _conversations: ConversationRepository;
    private readonly _messages: MessageRepository;
    private readonly _participants: ParticipantRepository;
    private readonly _drafts: DraftRepository;
    private readonly _inboxes: InboxRepository;
    private readonly _notifications: NotificationRepository;
    private readonly _receipts: ReadReceiptRepository;
    private readonly _rbac: RbacService | undefined;

    constructor(opts: ConvoServiceOptions) {
        this._conversations = opts.conversations;
        this._messages = opts.messages;
        this._participants = opts.participants;
        this._drafts = opts.drafts;
        this._inboxes = opts.inboxes;
        this._notifications = opts.notifications;
        this._receipts = opts.receipts;
        this._rbac = opts.rbac;
    }

    // ── Conversations ─────────────────────────────────────────────────────────

    async createConversation(
        ctx: ServerContext,
        callerIri: string,
        input: {
            subjectIri: string;
            title: string;
            initialMessage?: string;
            contentType?: ContentType;
            inboxId?: string;
            assignedTo?: string;
            participantIds?: string[];
        },
    ): Promise<{ conversation: ConversationEntity; message?: MessageEntity }> {
        await this._assert(ctx, callerIri, PERM_CONVO_CREATE);

        const conversation = await this._conversations.create(ctx, {
            subjectIri: input.subjectIri,
            title: input.title,
            createdBy: callerIri,
            inboxId: input.inboxId,
            assignedTo: input.assignedTo,
        });

        await this._participants.create(ctx, {
            conversationId: conversation.id,
            userId: callerIri,
            role: "owner",
        });

        for (const pid of input.participantIds ?? []) {
            if (pid !== callerIri) {
                await this._participants.create(ctx, {
                    conversationId: conversation.id,
                    userId: pid,
                    role: "member",
                });
            }
        }

        let message: MessageEntity | undefined;

        if (input.initialMessage) {
            message = await this._messages.create(ctx, {
                conversationId: conversation.id,
                authorId: callerIri,
                content: input.initialMessage,
                contentType: input.contentType ?? "text/markdown",
            });
            await this._fanOutMessageNotification(ctx, conversation.id, message, callerIri);
        }

        return { conversation, message };
    }

    async getConversation(
        ctx: ServerContext,
        conversationId: string,
    ): Promise<ConversationEntity | null> {
        return this._conversations.findById(ctx, conversationId);
    }

    async getConversationsForSubject(
        ctx: ServerContext,
        subjectIri: string,
    ): Promise<ConversationEntity[]> {
        return this._conversations.findBySubject(ctx, subjectIri);
    }

    async closeConversation(
        ctx: ServerContext,
        callerIri: string,
        conversationId: string,
    ): Promise<ConversationEntity | null> {
        await this._assert(ctx, callerIri, PERM_CONVO_CLOSE, conversationId);
        return this._conversations.updateStatus(ctx, conversationId, "closed");
    }

    async archiveConversation(
        ctx: ServerContext,
        callerIri: string,
        conversationId: string,
    ): Promise<ConversationEntity | null> {
        await this._assert(ctx, callerIri, PERM_CONVO_ARCHIVE, conversationId);
        return this._conversations.updateStatus(ctx, conversationId, "archived");
    }

    async reopenConversation(
        ctx: ServerContext,
        conversationId: string,
    ): Promise<ConversationEntity | null> {
        return this._conversations.updateStatus(ctx, conversationId, "open");
    }

    async assignConversation(
        ctx: ServerContext,
        callerIri: string,
        conversationId: string,
        assignedTo: string | null,
    ): Promise<ConversationEntity | null> {
        await this._assert(ctx, callerIri, PERM_CONVO_ASSIGN, conversationId);
        return this._conversations.updateAssignment(ctx, conversationId, assignedTo);
    }

    // ── Messages ──────────────────────────────────────────────────────────────

    async postMessage(
        ctx: ServerContext,
        callerIri: string,
        input: {
            conversationId: string;
            content: string;
            contentType?: ContentType;
            replyToId?: string;
        },
    ): Promise<MessageEntity> {
        await this._assert(ctx, callerIri, PERM_MESSAGE_POST, input.conversationId);

        const message = await this._messages.create(ctx, {
            conversationId: input.conversationId,
            authorId: callerIri,
            content: input.content,
            contentType: input.contentType ?? "text/markdown",
            replyToId: input.replyToId,
        });

        await this._fanOutMessageNotification(ctx, input.conversationId, message, callerIri);
        return message;
    }

    async editMessage(
        ctx: ServerContext,
        callerIri: string,
        messageId: string,
        newContent: string,
    ): Promise<{ message: MessageEntity; revision: MessageRevisionEntity } | null> {
        const existing = await this._messages.findById(ctx, messageId);
        if (!existing) {
            return null;
        }

        const isOwnMessage = existing.authorId === callerIri;
        await this._assertEditPermission(ctx, callerIri, isOwnMessage, existing.conversationId);

        return this._messages.edit(ctx, messageId, newContent, callerIri);
    }

    async deleteMessage(
        ctx: ServerContext,
        callerIri: string,
        messageId: string,
    ): Promise<MessageEntity | null> {
        const existing = await this._messages.findById(ctx, messageId);
        if (!existing) {
            return null;
        }

        const isOwnMessage = existing.authorId === callerIri;
        await this._assertDeletePermission(ctx, callerIri, isOwnMessage, existing.conversationId);

        return this._messages.softDelete(ctx, messageId);
    }

    async getMessagesForConversation(
        ctx: ServerContext,
        conversationId: string,
    ): Promise<MessageEntity[]> {
        return this._messages.findByConversation(ctx, conversationId);
    }

    async getMessageRevisions(
        ctx: ServerContext,
        messageId: string,
    ): Promise<MessageRevisionEntity[]> {
        return this._messages.findRevisionsForMessage(ctx, messageId);
    }

    // ── Participants ──────────────────────────────────────────────────────────

    async addParticipant(
        ctx: ServerContext,
        callerIri: string,
        conversationId: string,
        userId: string,
        role: ParticipantRole,
    ): Promise<ParticipantEntity> {
        await this._assert(ctx, callerIri, PERM_PARTICIPANT_MANAGE, conversationId);
        return this._participants.create(ctx, { conversationId, userId, role });
    }

    async removeParticipant(
        ctx: ServerContext,
        callerIri: string,
        conversationId: string,
        userId: string,
    ): Promise<void> {
        await this._assert(ctx, callerIri, PERM_PARTICIPANT_MANAGE, conversationId);
        const p = await this._participants.findByConversationAndUser(
            ctx,
            conversationId,
            userId,
        );
        if (p) {
            await this._participants.remove(ctx, p.id);
        }
    }

    async getParticipants(
        ctx: ServerContext,
        conversationId: string,
    ): Promise<ParticipantEntity[]> {
        return this._participants.findByConversation(ctx, conversationId);
    }

    // ── Drafts ────────────────────────────────────────────────────────────────

    async createDraft(
        ctx: ServerContext,
        input: {
            conversationId: string;
            authorId: string;
            content: string;
            contentType?: ContentType;
            replyToId?: string;
        },
    ): Promise<DraftEntity> {
        return this._drafts.create(ctx, {
            conversationId: input.conversationId,
            authorId: input.authorId,
            content: input.content,
            contentType: input.contentType ?? "text/markdown",
            replyToId: input.replyToId,
        });
    }

    async updateDraft(
        ctx: ServerContext,
        draftId: string,
        content: string,
    ): Promise<DraftEntity | null> {
        return this._drafts.update(ctx, draftId, content);
    }

    async sendDraft(
        ctx: ServerContext,
        callerIri: string,
        draftId: string,
    ): Promise<MessageEntity | null> {
        const draft = await this._drafts.findById(ctx, draftId);
        if (!draft) {
            return null;
        }

        await this._assert(ctx, callerIri, PERM_MESSAGE_POST, draft.conversationId);

        const message = await this._messages.create(ctx, {
            conversationId: draft.conversationId,
            authorId: draft.authorId,
            content: draft.content,
            contentType: draft.contentType,
            replyToId: draft.replyToId ?? undefined,
        });

        await this._drafts.delete(ctx, draftId);
        await this._fanOutMessageNotification(ctx, draft.conversationId, message, callerIri);

        return message;
    }

    async discardDraft(ctx: ServerContext, draftId: string): Promise<void> {
        await this._drafts.delete(ctx, draftId);
    }

    async getDraftsForAuthor(
        ctx: ServerContext,
        authorId: string,
        conversationId?: string,
    ): Promise<DraftEntity[]> {
        if (conversationId) {
            return this._drafts.findByAuthorAndConversation(ctx, authorId, conversationId);
        }
        return this._drafts.findByAuthor(ctx, authorId);
    }

    // ── Inboxes ───────────────────────────────────────────────────────────────

    async createInbox(
        ctx: ServerContext,
        callerIri: string,
        input: { subjectIri: string; name: string; memberIds?: string[] },
    ): Promise<InboxEntity> {
        await this._assert(ctx, callerIri, PERM_INBOX_CREATE);

        const inbox = await this._inboxes.create(ctx, {
            subjectIri: input.subjectIri,
            name: input.name,
            createdBy: callerIri,
        });

        await this._inboxes.addMember(ctx, inbox.id, callerIri, "owner");

        for (const memberId of input.memberIds ?? []) {
            if (memberId !== callerIri) {
                await this._inboxes.addMember(ctx, inbox.id, memberId, "member");
            }
        }

        return inbox;
    }

    async getInbox(ctx: ServerContext, inboxId: string): Promise<InboxEntity | null> {
        return this._inboxes.findById(ctx, inboxId);
    }

    async getInboxesForSubject(
        ctx: ServerContext,
        subjectIri: string,
    ): Promise<InboxEntity[]> {
        return this._inboxes.findBySubject(ctx, subjectIri);
    }

    async grantInboxAccess(
        ctx: ServerContext,
        callerIri: string,
        inboxId: string,
        userId: string,
        role: InboxRole,
    ): Promise<InboxMembershipEntity> {
        await this._assert(ctx, callerIri, PERM_INBOX_MANAGE, inboxId);
        return this._inboxes.addMember(ctx, inboxId, userId, role);
    }

    async revokeInboxAccess(
        ctx: ServerContext,
        callerIri: string,
        inboxId: string,
        userId: string,
    ): Promise<void> {
        await this._assert(ctx, callerIri, PERM_INBOX_MANAGE, inboxId);
        await this._inboxes.removeMember(ctx, inboxId, userId);
    }

    async getInboxMembers(
        ctx: ServerContext,
        inboxId: string,
    ): Promise<InboxMembershipEntity[]> {
        return this._inboxes.listMembers(ctx, inboxId);
    }

    async getConversationsInInbox(
        ctx: ServerContext,
        inboxId: string,
    ): Promise<ConversationEntity[]> {
        return this._conversations.findByInbox(ctx, inboxId);
    }

    // ── Read receipts ─────────────────────────────────────────────────────────

    /**
     * Mark that userId has read up to lastReadMessageId in this conversation.
     * Advances the read receipt watermark and dismisses superseded notifications.
     *
     * This is the "one-time" path: future messages will produce new notifications,
     * but messages already covered by this receipt will not.
     */
    async markConversationRead(
        ctx: ServerContext,
        userId: string,
        conversationId: string,
        lastReadMessageId: string,
    ): Promise<ReadReceiptEntity> {
        const receipt = await this._receipts.upsert(
            ctx,
            conversationId,
            userId,
            lastReadMessageId,
        );

        // Dismiss any outstanding notifications sourced from this conversation
        // that pre-date the new watermark.
        const lastReadMsg = await this._messages.findById(ctx, lastReadMessageId);
        if (lastReadMsg) {
            const notifs = await this._notifications.findByUser(ctx, userId, { unreadOnly: true });
            for (const n of notifs) {
                if (n.sourceIri === lastReadMsg.iri || n.sourceIri.includes(`/message/`)) {
                    await this._notifications.dismiss(ctx, n.id);
                }
            }
        }

        return receipt;
    }

    async getReadReceipt(
        ctx: ServerContext,
        conversationId: string,
        userId: string,
    ): Promise<ReadReceiptEntity | null> {
        return this._receipts.findByConversationAndUser(ctx, conversationId, userId);
    }

    async getReadReceiptsForConversation(
        ctx: ServerContext,
        conversationId: string,
    ): Promise<ReadReceiptEntity[]> {
        return this._receipts.findByConversation(ctx, conversationId);
    }

    /**
     * Count messages in this conversation that the user has not yet read
     * (i.e., were posted after their read receipt watermark).
     */
    async getUnreadMessageCount(
        ctx: ServerContext,
        conversationId: string,
        userId: string,
    ): Promise<number> {
        const receipt = await this._receipts.findByConversationAndUser(
            ctx,
            conversationId,
            userId,
        );

        const messages = await this._messages.findByConversation(ctx, conversationId);
        const visible = messages.filter((m) => !m.isDeleted);

        if (!receipt) {
            return visible.length;
        }

        const watermarkMsg = visible.find((m) => m.id === receipt.lastReadMessageId);
        if (!watermarkMsg) {
            return visible.length;
        }

        return visible.filter(
            (m) => m.createdAt.getTime() > watermarkMsg.createdAt.getTime(),
        ).length;
    }

    // ── Notifications ─────────────────────────────────────────────────────────

    async getNotificationsForUser(
        ctx: ServerContext,
        userId: string,
        opts: { unreadOnly?: boolean } = {},
    ): Promise<NotificationEntity[]> {
        return this._notifications.findByUser(ctx, userId, opts);
    }

    async getUnreadCount(ctx: ServerContext, userId: string): Promise<number> {
        return this._notifications.countUnread(ctx, userId);
    }

    async markNotificationRead(
        ctx: ServerContext,
        notificationId: string,
    ): Promise<NotificationEntity | null> {
        return this._notifications.markRead(ctx, notificationId);
    }

    async markAllNotificationsRead(
        ctx: ServerContext,
        userId: string,
    ): Promise<number> {
        return this._notifications.markAllReadForUser(ctx, userId);
    }

    async dismissNotification(
        ctx: ServerContext,
        notificationId: string,
    ): Promise<NotificationEntity | null> {
        return this._notifications.dismiss(ctx, notificationId);
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    private async _assert(
        ctx: ServerContext,
        principalIri: string,
        permission: string,
        scopeConversationId?: string,
    ): Promise<void> {
        if (!this._rbac) {
            return;
        }

        let scopeIri: string | undefined;
        if (scopeConversationId) {
            const conv = await this._conversations.findById(ctx, scopeConversationId);
            scopeIri = conv?.iri;
        }

        await this._rbac.assert(ctx, {
            principal: principalIri,
            permission,
            scope: scopeIri,
        });
    }

    private async _assertEditPermission(
        ctx: ServerContext,
        callerIri: string,
        isOwn: boolean,
        conversationId: string,
    ): Promise<void> {
        if (!this._rbac) {
            return;
        }

        const conv = await this._conversations.findById(ctx, conversationId);
        const scopeIri = conv?.iri;

        if (isOwn) {
            const canEditOwn = await this._rbac.can(ctx, {
                principal: callerIri,
                permission: PERM_MESSAGE_EDIT_OWN,
                scope: scopeIri,
            });
            const canEditAny = await this._rbac.can(ctx, {
                principal: callerIri,
                permission: PERM_MESSAGE_EDIT_ANY,
                scope: scopeIri,
            });
            if (!canEditOwn && !canEditAny) {
                throw new Error(
                    `Access denied: "${callerIri}" lacks permission to edit messages.`,
                );
            }
        } else {
            await this._rbac.assert(ctx, {
                principal: callerIri,
                permission: PERM_MESSAGE_EDIT_ANY,
                scope: scopeIri,
            });
        }
    }

    private async _assertDeletePermission(
        ctx: ServerContext,
        callerIri: string,
        isOwn: boolean,
        conversationId: string,
    ): Promise<void> {
        if (!this._rbac) {
            return;
        }

        const conv = await this._conversations.findById(ctx, conversationId);
        const scopeIri = conv?.iri;

        if (isOwn) {
            const canDeleteOwn = await this._rbac.can(ctx, {
                principal: callerIri,
                permission: PERM_MESSAGE_DELETE_OWN,
                scope: scopeIri,
            });
            const canDeleteAny = await this._rbac.can(ctx, {
                principal: callerIri,
                permission: PERM_MESSAGE_DELETE_ANY,
                scope: scopeIri,
            });
            if (!canDeleteOwn && !canDeleteAny) {
                throw new Error(
                    `Access denied: "${callerIri}" lacks permission to delete messages.`,
                );
            }
        } else {
            await this._rbac.assert(ctx, {
                principal: callerIri,
                permission: PERM_MESSAGE_DELETE_ANY,
                scope: scopeIri,
            });
        }
    }

    private async _fanOutMessageNotification(
        ctx: ServerContext,
        conversationId: string,
        message: MessageEntity,
        authorIri: string,
    ): Promise<void> {
        const participants = await this._participants.findByConversation(ctx, conversationId);

        for (const p of participants) {
            if (p.userId === authorIri) {
                continue;
            }

            // Skip if the user already has a read receipt past this message —
            // they're actively watching the conversation and don't need a ping.
            const receipt = await this._receipts.findByConversationAndUser(
                ctx,
                conversationId,
                p.userId,
            );
            if (receipt) {
                const watermark = await this._messages.findById(ctx, receipt.lastReadMessageId);
                if (
                    watermark &&
                    watermark.createdAt.getTime() >= message.createdAt.getTime()
                ) {
                    continue;
                }
            }

            const notifType = message.replyToId ? "reply" : "reply";
            await this._notifications.create(ctx, {
                userId: p.userId,
                notifType,
                sourceIri: message.iri,
            });
        }
    }
}
