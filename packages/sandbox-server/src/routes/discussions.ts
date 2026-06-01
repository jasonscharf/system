/**
 * Discussions API routes mounted at /api/convos.
 *
 * Access model:
 *   - ANON_IRI has ConvoModerator granted at startup — works without any login.
 *   - Authenticated users (valid session cookie / Bearer token) are lazily
 *     provisioned with ConvoUser on their first request so they can participate.
 *   - RBAC is enforced by ConvoService; all permission errors surface as 403.
 */

import type { AuthRouterComponent, UserEntity } from "@jasonscharf/auth";
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
import type { RbacService } from "@jasonscharf/rbac";
import { defaultServerContext } from "@jasonscharf/server";

export const ANON_IRI = "http://tern.dev/sandbox/user/anon";

const ctx = defaultServerContext;

// ── Helpers ───────────────────────────────────────────────────────────────────

function sessionUser(c: HttpCtx): UserEntity | undefined {
    return c.user as UserEntity | undefined;
}

function callerIri(c: HttpCtx): string {
    return sessionUser(c)?.iri ?? ANON_IRI;
}

function body(c: HttpCtx): Record<string, unknown> {
    return (c.req.body ?? {}) as Record<string, unknown>;
}

function q(c: HttpCtx, key: string): string | undefined {
    return c.query.get(key) ?? undefined;
}

// ── Auto-provision ────────────────────────────────────────────────────────────

/**
 * Lazily grant ConvoUser to an authenticated caller on their first discussions
 * request. This is idempotent — if they already have the permission it's a
 * no-op at the RBAC layer.
 *
 * The grant is scoped system-wide, same as the anon grant.
 */
async function ensureUserProvisioned(
    rbac: RbacService,
    userIri: string,
    userRoleIri: string,
): Promise<void> {
    const alreadyGranted = await rbac.can(ctx, {
        principal: userIri,
        permission: "tern.convos:conversation.create",
    });
    if (!alreadyGranted) {
        await rbac.grant(ctx, { principalIri: userIri, roleIri: userRoleIri });
        console.log(`[convos] auto-provisioned ConvoUser for ${userIri}`);
    }
}

// ── Mount ─────────────────────────────────────────────────────────────────────

export function mountDiscussionsRoutes(
    router: HttpRouter,
    store: TripleStore,
    rbac: RbacService,
    auth: AuthRouterComponent,
    userRoleIri: string,
): void {
    const svc = new ConvoService({
        conversations: new ConversationRepository(store),
        messages: new MessageRepository(store),
        participants: new ParticipantRepository(store),
        drafts: new DraftRepository(store),
        inboxes: new InboxRepository(store),
        notifications: new NotificationRepository(store),
        receipts: new ReadReceiptRepository(store),
        rbac,
    });

    // Session middleware populates ctx.user for every /api/convos request.
    const sessionMW = auth.sessionMiddleware();

    async function handle(c: HttpCtx, handler: (c: HttpCtx) => Promise<void>): Promise<void> {
        // Resolve session user and auto-provision if needed.
        await sessionMW(c, async () => {});
        const user = sessionUser(c);
        if (user) {
            await ensureUserProvisioned(rbac, user.iri, userRoleIri);
        }
        try {
            await handler(c);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("Access denied")) {
                c.status = 403;
                c.body = { error: msg };
            } else {
                c.status = 500;
                c.body = { error: "Internal server error" };
                console.error("[convos] unhandled error:", err);
            }
        }
    }

    // ── Conversations ─────────────────────────────────────────────────────────

    router.get("/api/convos/conversations", (c) =>
        handle(c, async (c) => {
            const subjectIri = q(c, "subjectIri");
            if (!subjectIri) {
                c.status = 400;
                c.body = { error: "subjectIri query param required" };
                return;
            }
            c.body = await svc.getConversationsForSubject(ctx, subjectIri);
        }),
    );

    router.post("/api/convos/conversations", (c) =>
        handle(c, async (c) => {
            const b = body(c);
            const subjectIri = b.subjectIri as string | undefined;
            const title = b.title as string | undefined;
            if (!subjectIri || !title) {
                c.status = 400;
                c.body = { error: "subjectIri and title required" };
                return;
            }
            const result = await svc.createConversation(ctx, callerIri(c), {
                subjectIri,
                title,
                initialMessage: b.initialMessage as string | undefined,
            });
            c.status = 201;
            c.body = result;
        }),
    );

    router.get("/api/convos/conversations/:id", (c) =>
        handle(c, async (c) => {
            const convo = await svc.getConversation(ctx, c.params.id);
            if (!convo) {
                c.status = 404;
                c.body = { error: "not found" };
                return;
            }
            c.body = convo;
        }),
    );

    router.post("/api/convos/conversations/:id/close", (c) =>
        handle(c, async (c) => {
            c.body = (await svc.closeConversation(ctx, callerIri(c), c.params.id)) ?? {
                error: "not found",
            };
        }),
    );

    // ── Messages ──────────────────────────────────────────────────────────────

    router.get("/api/convos/conversations/:id/messages", (c) =>
        handle(c, async (c) => {
            c.body = await svc.getMessagesForConversation(ctx, c.params.id);
        }),
    );

    router.post("/api/convos/conversations/:id/messages", (c) =>
        handle(c, async (c) => {
            const b = body(c);
            const content = b.content as string | undefined;
            if (!content) {
                c.status = 400;
                c.body = { error: "content required" };
                return;
            }
            const message = await svc.postMessage(ctx, callerIri(c), {
                conversationId: c.params.id,
                content,
                replyToId: b.replyToId as string | undefined,
            });
            c.status = 201;
            c.body = message;
        }),
    );

    router.patch("/api/convos/messages/:id", (c) =>
        handle(c, async (c) => {
            const b = body(c);
            const content = b.content as string | undefined;
            if (!content) {
                c.status = 400;
                c.body = { error: "content required" };
                return;
            }
            const result = await svc.editMessage(ctx, callerIri(c), c.params.id, content);
            if (!result) {
                c.status = 404;
                c.body = { error: "not found or deleted" };
                return;
            }
            c.body = result;
        }),
    );

    router.delete("/api/convos/messages/:id", (c) =>
        handle(c, async (c) => {
            c.body = (await svc.deleteMessage(ctx, callerIri(c), c.params.id)) ?? {
                error: "not found",
            };
        }),
    );

    // ── Read receipts ─────────────────────────────────────────────────────────

    router.post("/api/convos/conversations/:id/read", (c) =>
        handle(c, async (c) => {
            const b = body(c);
            const userId = (b.userId as string | undefined) ?? callerIri(c);
            const lastReadMessageId = b.lastReadMessageId as string | undefined;
            if (!lastReadMessageId) {
                c.status = 400;
                c.body = { error: "lastReadMessageId required" };
                return;
            }
            c.body = await svc.markConversationRead(ctx, userId, c.params.id, lastReadMessageId);
        }),
    );

    router.get("/api/convos/conversations/:id/unread", (c) =>
        handle(c, async (c) => {
            const userId = q(c, "userId") ?? callerIri(c);
            c.body = { unread: await svc.getUnreadMessageCount(ctx, c.params.id, userId) };
        }),
    );

    // ── Participants ──────────────────────────────────────────────────────────

    router.get("/api/convos/conversations/:id/participants", (c) =>
        handle(c, async (c) => {
            c.body = await svc.getParticipants(ctx, c.params.id);
        }),
    );

    // ── Notifications ─────────────────────────────────────────────────────────

    router.get("/api/convos/notifications", (c) =>
        handle(c, async (c) => {
            const userId = q(c, "userId") ?? callerIri(c);
            const unreadOnly = q(c, "unreadOnly") === "true";
            c.body = await svc.getNotificationsForUser(ctx, userId, { unreadOnly });
        }),
    );

    router.post("/api/convos/notifications/:id/read", (c) =>
        handle(c, async (c) => {
            c.body = await svc.markNotificationRead(ctx, c.params.id);
        }),
    );

    router.post("/api/convos/notifications/read-all", (c) =>
        handle(c, async (c) => {
            const userId = (body(c).userId as string | undefined) ?? callerIri(c);
            c.body = { marked: await svc.markAllNotificationsRead(ctx, userId) };
        }),
    );

    router.post("/api/convos/notifications/:id/dismiss", (c) =>
        handle(c, async (c) => {
            c.body = await svc.dismissNotification(ctx, c.params.id);
        }),
    );

    // ── Current user info ─────────────────────────────────────────────────────

    router.get("/api/convos/me", (c) =>
        handle(c, async (c) => {
            const user = sessionUser(c);
            c.body = {
                iri: callerIri(c),
                authenticated: user != null,
                email: user?.email,
                displayName: user?.displayName,
            };
        }),
    );
}
