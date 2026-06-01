/**
 * Discussions API routes mounted at /api/convos.
 *
 * All mutations fall back to a synthetic "anonymous" caller IRI when no
 * session is present so the sandbox works out of the box without OAuth.
 */

import {
    ConversationRepository,
    ConvoService,
    DraftRepository,
    InboxRepository,
    MessageRepository,
    NotificationRepository,
    ParticipantRepository,
    ReadReceiptRepository,
} from "@jasonscharf/convos";
import type { TripleStore } from "@jasonscharf/data";
import type { HttpCtx, HttpRouter } from "@jasonscharf/flow";
import { defaultServerContext } from "@jasonscharf/server";

const ANON_IRI = "http://tern.dev/sandbox/user/anon";
const ctx = defaultServerContext;

type Handler = (c: HttpCtx) => Promise<void>;

function body(c: HttpCtx): Record<string, unknown> {
    return (c.req.body ?? {}) as Record<string, unknown>;
}

function q(c: HttpCtx, key: string): string | undefined {
    return c.query.get(key) ?? undefined;
}

export function mountDiscussionsRoutes(router: HttpRouter, store: TripleStore): void {
    const svc = new ConvoService({
        conversations: new ConversationRepository(store),
        messages: new MessageRepository(store),
        participants: new ParticipantRepository(store),
        drafts: new DraftRepository(store),
        inboxes: new InboxRepository(store),
        notifications: new NotificationRepository(store),
        receipts: new ReadReceiptRepository(store),
    });

    // ── Conversations ─────────────────────────────────────────────────────────

    const listConversations: Handler = async (c) => {
        const subjectIri = q(c, "subjectIri");
        if (!subjectIri) {
            c.status = 400;
            c.body = { error: "subjectIri query param required" };
            return;
        }
        c.body = await svc.getConversationsForSubject(ctx, subjectIri);
    };
    router.get("/api/convos/conversations", listConversations);

    const createConversation: Handler = async (c) => {
        const b = body(c);
        const subjectIri = b.subjectIri as string | undefined;
        const title = b.title as string | undefined;
        if (!subjectIri || !title) {
            c.status = 400;
            c.body = { error: "subjectIri and title required" };
            return;
        }
        const callerIri = (b.callerIri as string | undefined) ?? ANON_IRI;
        const result = await svc.createConversation(ctx, callerIri, {
            subjectIri,
            title,
            initialMessage: b.initialMessage as string | undefined,
        });
        c.status = 201;
        c.body = result;
    };
    router.post("/api/convos/conversations", createConversation);

    const getConversation: Handler = async (c) => {
        const convo = await svc.getConversation(ctx, c.params.id);
        if (!convo) {
            c.status = 404;
            c.body = { error: "not found" };
            return;
        }
        c.body = convo;
    };
    router.get("/api/convos/conversations/:id", getConversation);

    const closeConversation: Handler = async (c) => {
        c.body = (await svc.closeConversation(ctx, ANON_IRI, c.params.id)) ?? { error: "not found" };
    };
    router.post("/api/convos/conversations/:id/close", closeConversation);

    // ── Messages ──────────────────────────────────────────────────────────────

    const listMessages: Handler = async (c) => {
        c.body = await svc.getMessagesForConversation(ctx, c.params.id);
    };
    router.get("/api/convos/conversations/:id/messages", listMessages);

    const postMessage: Handler = async (c) => {
        const b = body(c);
        const content = b.content as string | undefined;
        if (!content) {
            c.status = 400;
            c.body = { error: "content required" };
            return;
        }
        const callerIri = (b.callerIri as string | undefined) ?? ANON_IRI;
        const message = await svc.postMessage(ctx, callerIri, {
            conversationId: c.params.id,
            content,
            replyToId: b.replyToId as string | undefined,
        });
        c.status = 201;
        c.body = message;
    };
    router.post("/api/convos/conversations/:id/messages", postMessage);

    const editMessage: Handler = async (c) => {
        const b = body(c);
        const content = b.content as string | undefined;
        if (!content) {
            c.status = 400;
            c.body = { error: "content required" };
            return;
        }
        const callerIri = (b.callerIri as string | undefined) ?? ANON_IRI;
        const result = await svc.editMessage(ctx, callerIri, c.params.id, content);
        if (!result) {
            c.status = 404;
            c.body = { error: "not found or deleted" };
            return;
        }
        c.body = result;
    };
    router.patch("/api/convos/messages/:id", editMessage);

    const deleteMessage: Handler = async (c) => {
        const callerIri = q(c, "callerIri") ?? ANON_IRI;
        c.body = (await svc.deleteMessage(ctx, callerIri, c.params.id)) ?? { error: "not found" };
    };
    router.delete("/api/convos/messages/:id", deleteMessage);

    // ── Read receipts ─────────────────────────────────────────────────────────

    const markRead: Handler = async (c) => {
        const b = body(c);
        const userId = (b.userId as string | undefined) ?? ANON_IRI;
        const lastReadMessageId = b.lastReadMessageId as string | undefined;
        if (!lastReadMessageId) {
            c.status = 400;
            c.body = { error: "lastReadMessageId required" };
            return;
        }
        c.body = await svc.markConversationRead(ctx, userId, c.params.id, lastReadMessageId);
    };
    router.post("/api/convos/conversations/:id/read", markRead);

    const getUnread: Handler = async (c) => {
        const userId = q(c, "userId") ?? ANON_IRI;
        c.body = { unread: await svc.getUnreadMessageCount(ctx, c.params.id, userId) };
    };
    router.get("/api/convos/conversations/:id/unread", getUnread);

    // ── Participants ──────────────────────────────────────────────────────────

    const listParticipants: Handler = async (c) => {
        c.body = await svc.getParticipants(ctx, c.params.id);
    };
    router.get("/api/convos/conversations/:id/participants", listParticipants);

    // ── Notifications ─────────────────────────────────────────────────────────

    const listNotifications: Handler = async (c) => {
        const userId = q(c, "userId") ?? ANON_IRI;
        const unreadOnly = q(c, "unreadOnly") === "true";
        c.body = await svc.getNotificationsForUser(ctx, userId, { unreadOnly });
    };
    router.get("/api/convos/notifications", listNotifications);

    const markNotifRead: Handler = async (c) => {
        c.body = await svc.markNotificationRead(ctx, c.params.id);
    };
    router.post("/api/convos/notifications/:id/read", markNotifRead);

    const markAllRead: Handler = async (c) => {
        const userId = (body(c).userId as string | undefined) ?? ANON_IRI;
        c.body = { marked: await svc.markAllNotificationsRead(ctx, userId) };
    };
    router.post("/api/convos/notifications/read-all", markAllRead);

    const dismissNotif: Handler = async (c) => {
        c.body = await svc.dismissNotification(ctx, c.params.id);
    };
    router.post("/api/convos/notifications/:id/dismiss", dismissNotif);
}
