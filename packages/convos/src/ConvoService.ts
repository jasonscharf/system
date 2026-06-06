import type { RbacService, SecurityContext, ServerContext } from "@jasonscharf/server";
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

export interface CreateConversationArgs {
    subjectIri: string;
    title: string;
    initialMessage?: string;
    contentType?: ContentType;
    inboxId?: string;
    assignedTo?: string;
    participantIds?: string[];
}

export interface PostMessageArgs {
    conversationId: string;
    content: string;
    contentType?: ContentType;
    replyToId?: string;
}

export interface CreateDraftArgs {
    conversationId: string;
    authorId: string;
    content: string;
    contentType?: ContentType;
    replyToId?: string;
}

export interface CreateInboxArgs {
    subjectIri: string;
    name: string;
    memberIds?: string[];
}

export interface ConversationIdArgs {
    conversationId: string;
}

export interface SubjectIriArgs {
    subjectIri: string;
}

export interface AssignConversationArgs {
    conversationId: string;
    assignedTo: string | null;
}

export interface EditMessageArgs {
    messageId: string;
    newContent: string;
}

export interface MessageIdArgs {
    messageId: string;
}

export interface AddParticipantArgs {
    conversationId: string;
    userId: string;
    role: ParticipantRole;
}

export interface ConversationUserArgs {
    conversationId: string;
    userId: string;
}

export interface UpdateDraftArgs {
    draftId: string;
    content: string;
}

export interface DraftIdArgs {
    draftId: string;
}

export interface GetDraftsForAuthorArgs {
    authorId: string;
    conversationId?: string;
}

export interface InboxIdArgs {
    inboxId: string;
}

export interface GrantInboxAccessArgs {
    inboxId: string;
    userId: string;
    role: InboxRole;
}

export interface RevokeInboxAccessArgs {
    inboxId: string;
    userId: string;
}

export interface MarkConversationReadArgs {
    conversationId: string;
    userId: string;
    lastReadMessageId: string;
}

export interface GetNotificationsForUserArgs {
    userId: string;
    unreadOnly?: boolean;
}

export interface UserIdArgs {
    userId: string;
}

export interface NotificationIdArgs {
    notificationId: string;
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

    get store() {
        return this._conversations.store;
    }

    // ── Conversations ─────────────────────────────────────────────────────────

    async createConversation(
        ctx: ServerContext,
        sec: SecurityContext,
        args: CreateConversationArgs,
    ): Promise<{ conversation: ConversationEntity; message?: MessageEntity }> {
        await this._assert(ctx, sec, PERM_CONVO_CREATE);
        const callerIri = sec.principalIri ?? "";

        const conversation = await this._conversations.create(ctx, sec, {
            subjectIri: args.subjectIri,
            title: args.title,
            createdBy: callerIri,
            inboxId: args.inboxId,
            assignedTo: args.assignedTo,
        });

        await this._participants.create(ctx, sec, {
            conversationId: conversation.id,
            userId: callerIri,
            role: "owner",
        });

        for (const pid of args.participantIds ?? []) {
            if (pid !== callerIri) {
                await this._participants.create(ctx, sec, {
                    conversationId: conversation.id,
                    userId: pid,
                    role: "member",
                });
            }
        }

        let message: MessageEntity | undefined;

        if (args.initialMessage) {
            message = await this._messages.create(ctx, sec, {
                conversationId: conversation.id,
                authorId: callerIri,
                content: args.initialMessage,
                contentType: args.contentType ?? "text/markdown",
            });
            await this._fanOutMessageNotification(ctx, sec, conversation.id, message);
        }

        return { conversation, message };
    }

    async getConversation(
        ctx: ServerContext,
        sec: SecurityContext,
        args: ConversationIdArgs,
    ): Promise<ConversationEntity | null> {
        return this._conversations.findById(ctx, sec, { id: args.conversationId });
    }

    async getConversationsForSubject(
        ctx: ServerContext,
        sec: SecurityContext,
        args: SubjectIriArgs,
    ): Promise<ConversationEntity[]> {
        return this._conversations.findBySubject(ctx, sec, args);
    }

    async closeConversation(
        ctx: ServerContext,
        sec: SecurityContext,
        args: ConversationIdArgs,
    ): Promise<ConversationEntity | null> {
        await this._assert(ctx, sec, PERM_CONVO_CLOSE, args.conversationId);
        return this._conversations.updateStatus(ctx, sec, {
            id: args.conversationId,
            status: "closed",
        });
    }

    async archiveConversation(
        ctx: ServerContext,
        sec: SecurityContext,
        args: ConversationIdArgs,
    ): Promise<ConversationEntity | null> {
        await this._assert(ctx, sec, PERM_CONVO_ARCHIVE, args.conversationId);
        return this._conversations.updateStatus(ctx, sec, {
            id: args.conversationId,
            status: "archived",
        });
    }

    async reopenConversation(
        ctx: ServerContext,
        sec: SecurityContext,
        args: ConversationIdArgs,
    ): Promise<ConversationEntity | null> {
        return this._conversations.updateStatus(ctx, sec, {
            id: args.conversationId,
            status: "open",
        });
    }

    async assignConversation(
        ctx: ServerContext,
        sec: SecurityContext,
        args: AssignConversationArgs,
    ): Promise<ConversationEntity | null> {
        await this._assert(ctx, sec, PERM_CONVO_ASSIGN, args.conversationId);
        return this._conversations.updateAssignment(ctx, sec, {
            id: args.conversationId,
            assignedTo: args.assignedTo,
        });
    }

    // ── Messages ──────────────────────────────────────────────────────────────

    async postMessage(
        ctx: ServerContext,
        sec: SecurityContext,
        args: PostMessageArgs,
    ): Promise<MessageEntity> {
        await this._assert(ctx, sec, PERM_MESSAGE_POST, args.conversationId);
        const callerIri = sec.principalIri ?? "";

        const message = await this._messages.create(ctx, sec, {
            conversationId: args.conversationId,
            authorId: callerIri,
            content: args.content,
            contentType: args.contentType ?? "text/markdown",
            replyToId: args.replyToId,
        });

        await this._fanOutMessageNotification(ctx, sec, args.conversationId, message);
        return message;
    }

    async editMessage(
        ctx: ServerContext,
        sec: SecurityContext,
        args: EditMessageArgs,
    ): Promise<{ message: MessageEntity; revision: MessageRevisionEntity } | null> {
        const existing = await this._messages.findById(ctx, sec, { id: args.messageId });
        if (!existing) {
            return null;
        }

        const callerIri = sec.principalIri ?? "";
        const isOwnMessage = existing.authorId === callerIri;
        await this._assertEditPermission(ctx, sec, isOwnMessage, existing.conversationId);

        return this._messages.edit(ctx, sec, {
            id: args.messageId,
            newContent: args.newContent,
            editorId: callerIri,
        });
    }

    async deleteMessage(
        ctx: ServerContext,
        sec: SecurityContext,
        args: MessageIdArgs,
    ): Promise<MessageEntity | null> {
        const existing = await this._messages.findById(ctx, sec, { id: args.messageId });
        if (!existing) {
            return null;
        }

        const callerIri = sec.principalIri ?? "";
        const isOwnMessage = existing.authorId === callerIri;
        await this._assertDeletePermission(ctx, sec, isOwnMessage, existing.conversationId);

        return this._messages.softDelete(ctx, sec, { id: args.messageId });
    }

    async getMessagesForConversation(
        ctx: ServerContext,
        sec: SecurityContext,
        args: ConversationIdArgs,
    ): Promise<MessageEntity[]> {
        return this._messages.findByConversation(ctx, sec, args);
    }

    async getMessageRevisions(
        ctx: ServerContext,
        sec: SecurityContext,
        args: MessageIdArgs,
    ): Promise<MessageRevisionEntity[]> {
        return this._messages.findRevisionsForMessage(ctx, sec, args);
    }

    // ── Participants ──────────────────────────────────────────────────────────

    async addParticipant(
        ctx: ServerContext,
        sec: SecurityContext,
        args: AddParticipantArgs,
    ): Promise<ParticipantEntity> {
        await this._assert(ctx, sec, PERM_PARTICIPANT_MANAGE, args.conversationId);
        return this._participants.create(ctx, sec, args);
    }

    async removeParticipant(
        ctx: ServerContext,
        sec: SecurityContext,
        args: ConversationUserArgs,
    ): Promise<void> {
        await this._assert(ctx, sec, PERM_PARTICIPANT_MANAGE, args.conversationId);
        const p = await this._participants.findByConversationAndUser(ctx, sec, args);
        if (p) {
            await this._participants.remove(ctx, sec, { id: p.id });
        }
    }

    async getParticipants(
        ctx: ServerContext,
        sec: SecurityContext,
        args: ConversationIdArgs,
    ): Promise<ParticipantEntity[]> {
        return this._participants.findByConversation(ctx, sec, args);
    }

    // ── Drafts ────────────────────────────────────────────────────────────────

    async createDraft(
        ctx: ServerContext,
        sec: SecurityContext,
        args: CreateDraftArgs,
    ): Promise<DraftEntity> {
        return this._drafts.create(ctx, sec, {
            conversationId: args.conversationId,
            authorId: args.authorId,
            content: args.content,
            contentType: args.contentType ?? "text/markdown",
            replyToId: args.replyToId,
        });
    }

    async updateDraft(
        ctx: ServerContext,
        sec: SecurityContext,
        args: UpdateDraftArgs,
    ): Promise<DraftEntity | null> {
        return this._drafts.update(ctx, sec, { id: args.draftId, content: args.content });
    }

    async sendDraft(
        ctx: ServerContext,
        sec: SecurityContext,
        args: DraftIdArgs,
    ): Promise<MessageEntity | null> {
        const draft = await this._drafts.findById(ctx, sec, { id: args.draftId });
        if (!draft) {
            return null;
        }

        await this._assert(ctx, sec, PERM_MESSAGE_POST, draft.conversationId);

        const message = await this._messages.create(ctx, sec, {
            conversationId: draft.conversationId,
            authorId: draft.authorId,
            content: draft.content,
            contentType: draft.contentType,
            replyToId: draft.replyToId ?? undefined,
        });

        await this._drafts.delete(ctx, sec, { id: args.draftId });
        await this._fanOutMessageNotification(ctx, sec, draft.conversationId, message);

        return message;
    }

    async discardDraft(ctx: ServerContext, sec: SecurityContext, args: DraftIdArgs): Promise<void> {
        await this._drafts.delete(ctx, sec, { id: args.draftId });
    }

    async getDraftsForAuthor(
        ctx: ServerContext,
        sec: SecurityContext,
        args: GetDraftsForAuthorArgs,
    ): Promise<DraftEntity[]> {
        if (args.conversationId) {
            return this._drafts.findByAuthorAndConversation(ctx, sec, {
                authorId: args.authorId,
                conversationId: args.conversationId,
            });
        }
        return this._drafts.findByAuthor(ctx, sec, { authorId: args.authorId });
    }

    // ── Inboxes ───────────────────────────────────────────────────────────────

    async createInbox(
        ctx: ServerContext,
        sec: SecurityContext,
        args: CreateInboxArgs,
    ): Promise<InboxEntity> {
        await this._assert(ctx, sec, PERM_INBOX_CREATE);
        const callerIri = sec.principalIri ?? "";

        const inbox = await this._inboxes.create(ctx, sec, {
            subjectIri: args.subjectIri,
            name: args.name,
            createdBy: callerIri,
        });

        await this._inboxes.addMember(ctx, sec, {
            inboxId: inbox.id,
            userId: callerIri,
            role: "owner",
        });

        for (const memberId of args.memberIds ?? []) {
            if (memberId !== callerIri) {
                await this._inboxes.addMember(ctx, sec, {
                    inboxId: inbox.id,
                    userId: memberId,
                    role: "member",
                });
            }
        }

        return inbox;
    }

    async getInbox(
        ctx: ServerContext,
        sec: SecurityContext,
        args: InboxIdArgs,
    ): Promise<InboxEntity | null> {
        return this._inboxes.findById(ctx, sec, { id: args.inboxId });
    }

    async getInboxesForSubject(
        ctx: ServerContext,
        sec: SecurityContext,
        args: SubjectIriArgs,
    ): Promise<InboxEntity[]> {
        return this._inboxes.findBySubject(ctx, sec, args);
    }

    async grantInboxAccess(
        ctx: ServerContext,
        sec: SecurityContext,
        args: GrantInboxAccessArgs,
    ): Promise<InboxMembershipEntity> {
        await this._assert(ctx, sec, PERM_INBOX_MANAGE, args.inboxId);
        return this._inboxes.addMember(ctx, sec, args);
    }

    async revokeInboxAccess(
        ctx: ServerContext,
        sec: SecurityContext,
        args: RevokeInboxAccessArgs,
    ): Promise<void> {
        await this._assert(ctx, sec, PERM_INBOX_MANAGE, args.inboxId);
        await this._inboxes.removeMember(ctx, sec, args);
    }

    async getInboxMembers(
        ctx: ServerContext,
        sec: SecurityContext,
        args: InboxIdArgs,
    ): Promise<InboxMembershipEntity[]> {
        return this._inboxes.listMembers(ctx, sec, args);
    }

    async getConversationsInInbox(
        ctx: ServerContext,
        sec: SecurityContext,
        args: InboxIdArgs,
    ): Promise<ConversationEntity[]> {
        return this._conversations.findByInbox(ctx, sec, args);
    }

    // ── Read receipts ─────────────────────────────────────────────────────────

    /**
     * Mark that userId has read up to lastReadMessageId in this conversation.
     * Advances the read receipt watermark and dismisses superseded notifications.
     */
    async markConversationRead(
        ctx: ServerContext,
        sec: SecurityContext,
        args: MarkConversationReadArgs,
    ): Promise<ReadReceiptEntity> {
        const receipt = await this._receipts.upsert(ctx, sec, args);

        const lastReadMsg = await this._messages.findById(ctx, sec, {
            id: args.lastReadMessageId,
        });
        if (lastReadMsg) {
            const notifs = await this._notifications.findByUser(ctx, sec, {
                userId: args.userId,
                unreadOnly: true,
            });
            for (const n of notifs) {
                if (
                    n.sourceIri &&
                    (n.sourceIri === lastReadMsg.iri || n.sourceIri.includes("/message/"))
                ) {
                    await this._notifications.dismiss(ctx, sec, { id: n.id });
                }
            }
        }

        return receipt;
    }

    async getReadReceipt(
        ctx: ServerContext,
        sec: SecurityContext,
        args: ConversationUserArgs,
    ): Promise<ReadReceiptEntity | null> {
        return this._receipts.findByConversationAndUser(ctx, sec, args);
    }

    async getReadReceiptsForConversation(
        ctx: ServerContext,
        sec: SecurityContext,
        args: ConversationIdArgs,
    ): Promise<ReadReceiptEntity[]> {
        return this._receipts.findByConversation(ctx, sec, args);
    }

    /**
     * Count messages in this conversation that the user has not yet read.
     */
    async getUnreadMessageCount(
        ctx: ServerContext,
        sec: SecurityContext,
        args: ConversationUserArgs,
    ): Promise<number> {
        const receipt = await this._receipts.findByConversationAndUser(ctx, sec, args);
        const messages = await this._messages.findByConversation(ctx, sec, {
            conversationId: args.conversationId,
        });
        const visible = messages.filter((m) => !m.isDeleted);

        if (!receipt) {
            return visible.length;
        }

        const watermarkMsg = visible.find((m) => m.id === receipt.lastReadMessageId);
        if (!watermarkMsg) {
            return visible.length;
        }

        return visible.filter((m) => m.createdAt.getTime() > watermarkMsg.createdAt.getTime())
            .length;
    }

    // ── Notifications ─────────────────────────────────────────────────────────

    async getNotificationsForUser(
        ctx: ServerContext,
        sec: SecurityContext,
        args: GetNotificationsForUserArgs,
    ): Promise<NotificationEntity[]> {
        return this._notifications.findByUser(ctx, sec, args);
    }

    async getUnreadCount(
        ctx: ServerContext,
        sec: SecurityContext,
        args: UserIdArgs,
    ): Promise<number> {
        return this._notifications.countUnread(ctx, sec, args);
    }

    async markNotificationRead(
        ctx: ServerContext,
        sec: SecurityContext,
        args: NotificationIdArgs,
    ): Promise<NotificationEntity | null> {
        return this._notifications.markRead(ctx, sec, { id: args.notificationId });
    }

    async markAllNotificationsRead(
        ctx: ServerContext,
        sec: SecurityContext,
        args: UserIdArgs,
    ): Promise<number> {
        return this._notifications.markAllReadForUser(ctx, sec, args);
    }

    async dismissNotification(
        ctx: ServerContext,
        sec: SecurityContext,
        args: NotificationIdArgs,
    ): Promise<NotificationEntity | null> {
        return this._notifications.dismiss(ctx, sec, { id: args.notificationId });
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    private async _assert(
        ctx: ServerContext,
        sec: SecurityContext,
        permission: string,
        scopeConversationId?: string,
    ): Promise<void> {
        if (!this._rbac) {
            return;
        }

        let scope: string | undefined;
        if (scopeConversationId) {
            const conv = await this._conversations.findById(ctx, sec, {
                id: scopeConversationId,
            });
            scope = conv?.iri;
        }

        await this._rbac.assert(ctx, sec, { permission, scope });
    }

    private async _assertEditPermission(
        ctx: ServerContext,
        sec: SecurityContext,
        isOwn: boolean,
        conversationId: string,
    ): Promise<void> {
        if (!this._rbac) {
            return;
        }

        const conv = await this._conversations.findById(ctx, sec, { id: conversationId });
        const scope = conv?.iri;

        if (isOwn) {
            const canEditOwn = await this._rbac.can(ctx, sec, {
                permission: PERM_MESSAGE_EDIT_OWN,
                scope,
            });
            const canEditAny = await this._rbac.can(ctx, sec, {
                permission: PERM_MESSAGE_EDIT_ANY,
                scope,
            });
            if (!canEditOwn && !canEditAny) {
                throw new Error(
                    `Access denied: "${sec.principalIri}" lacks permission to edit messages.`,
                );
            }
        } else {
            await this._rbac.assert(ctx, sec, { permission: PERM_MESSAGE_EDIT_ANY, scope });
        }
    }

    private async _assertDeletePermission(
        ctx: ServerContext,
        sec: SecurityContext,
        isOwn: boolean,
        conversationId: string,
    ): Promise<void> {
        if (!this._rbac) {
            return;
        }

        const conv = await this._conversations.findById(ctx, sec, { id: conversationId });
        const scope = conv?.iri;

        if (isOwn) {
            const canDeleteOwn = await this._rbac.can(ctx, sec, {
                permission: PERM_MESSAGE_DELETE_OWN,
                scope,
            });
            const canDeleteAny = await this._rbac.can(ctx, sec, {
                permission: PERM_MESSAGE_DELETE_ANY,
                scope,
            });
            if (!canDeleteOwn && !canDeleteAny) {
                throw new Error(
                    `Access denied: "${sec.principalIri}" lacks permission to delete messages.`,
                );
            }
        } else {
            await this._rbac.assert(ctx, sec, { permission: PERM_MESSAGE_DELETE_ANY, scope });
        }
    }

    private async _fanOutMessageNotification(
        ctx: ServerContext,
        sec: SecurityContext,
        conversationId: string,
        message: MessageEntity,
    ): Promise<void> {
        const callerIri = sec.principalIri ?? "";
        const participants = await this._participants.findByConversation(ctx, sec, {
            conversationId,
        });

        for (const p of participants) {
            if (p.userId === callerIri) {
                continue;
            }

            const receipt = await this._receipts.findByConversationAndUser(ctx, sec, {
                conversationId,
                userId: p.userId,
            });
            if (receipt) {
                const watermark = await this._messages.findById(ctx, sec, {
                    id: receipt.lastReadMessageId,
                });
                if (watermark && watermark.createdAt.getTime() >= message.createdAt.getTime()) {
                    continue;
                }
            }

            const notifType = message.replyToId ? "reply" : "reply";
            await this._notifications.create(ctx, sec, {
                userId: p.userId,
                notifType,
                sourceIri: message.iri,
            });
        }
    }
}
