/**
 * Discussions API routes mounted at /api/convos.
 *
 * Access model:
 *   - Unauthenticated requests get anonymousSec → RBAC denies mutation routes.
 *   - Authenticated users are lazily provisioned with ConvoUser on their first
 *     request so they can participate without manual setup.
 *   - RBAC is enforced inside ConvoService; permission errors surface as 403.
 */

import type { AuthRouterComponent } from "@jasonscharf/auth";
import type { ConvoService } from "@jasonscharf/convos";
import type { HttpCtx, HttpRouter } from "@jasonscharf/flow";
import type { RbacService } from "@jasonscharf/server";
import {
    anonymousSec,
    buildServerContext,
    type SecurityContext,
    systemSec,
} from "@jasonscharf/server";

// ── Helpers ───────────────────────────────────────────────────────────────────

function sec(c: HttpCtx): SecurityContext {
    return (c.sec as SecurityContext | undefined) ?? anonymousSec;
}

function body(c: HttpCtx): Record<string, unknown> {
    return (c.req.body ?? {}) as Record<string, unknown>;
}

function q(c: HttpCtx, key: string): string | undefined {
    return c.query.get(key) ?? undefined;
}

// ── Auto-provision ────────────────────────────────────────────────────────────

async function ensureUserProvisioned(
    ctx: ReturnType<typeof buildServerContext>,
    rbac: RbacService,
    userSec: SecurityContext,
    userRoleIri: string,
): Promise<void> {
    if (!userSec.principalIri) {
        return;
    }
    const alreadyGranted = await rbac.can(ctx, userSec, {
        permission: "tern.convos:conversation.create",
    });
    if (!alreadyGranted) {
        await rbac.grant(ctx, systemSec, {
            principalIri: userSec.principalIri,
            roleIri: userRoleIri,
        });
        console.log(`[convos] auto-provisioned ConvoUser for ${userSec.principalIri}`);
    }
}

// ── Mount ─────────────────────────────────────────────────────────────────────

export function mountDiscussionsRoutes(
    router: HttpRouter,
    svc: ConvoService,
    rbac: RbacService,
    auth: AuthRouterComponent,
    userRoleIri: string,
): void {
    const ctx = buildServerContext(svc.store);
    const sessionMW = auth.sessionMiddleware();

    async function handle(c: HttpCtx, handler: (c: HttpCtx) => Promise<void>): Promise<void> {
        await sessionMW(c, async () => {});
        const userSec = sec(c);
        if (userSec.principalIri) {
            await ensureUserProvisioned(ctx, rbac, userSec, userRoleIri);
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
            c.body = await svc.getConversationsForSubject(ctx, sec(c), { subjectIri });
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
            const result = await svc.createConversation(ctx, sec(c), {
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
            const convo = await svc.getConversation(ctx, sec(c), {
                conversationId: c.params.id,
            });
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
            c.body = (await svc.closeConversation(ctx, sec(c), {
                conversationId: c.params.id,
            })) ?? { error: "not found" };
        }),
    );

    // ── Messages ──────────────────────────────────────────────────────────────

    router.get("/api/convos/conversations/:id/messages", (c) =>
        handle(c, async (c) => {
            c.body = await svc.getMessagesForConversation(ctx, sec(c), {
                conversationId: c.params.id,
            });
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
            const message = await svc.postMessage(ctx, sec(c), {
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
            const result = await svc.editMessage(ctx, sec(c), {
                messageId: c.params.id,
                newContent: content,
            });
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
            c.body = (await svc.deleteMessage(ctx, sec(c), { messageId: c.params.id })) ?? {
                error: "not found",
            };
        }),
    );

    // ── Read receipts ─────────────────────────────────────────────────────────

    router.post("/api/convos/conversations/:id/read", (c) =>
        handle(c, async (c) => {
            const b = body(c);
            const userId = (b.userId as string | undefined) ?? sec(c).principalIri ?? "";
            const lastReadMessageId = b.lastReadMessageId as string | undefined;
            if (!lastReadMessageId) {
                c.status = 400;
                c.body = { error: "lastReadMessageId required" };
                return;
            }
            c.body = await svc.markConversationRead(ctx, sec(c), {
                conversationId: c.params.id,
                userId,
                lastReadMessageId,
            });
        }),
    );

    router.get("/api/convos/conversations/:id/unread", (c) =>
        handle(c, async (c) => {
            const userId = q(c, "userId") ?? sec(c).principalIri ?? "";
            c.body = {
                unread: await svc.getUnreadMessageCount(ctx, sec(c), {
                    conversationId: c.params.id,
                    userId,
                }),
            };
        }),
    );

    // ── Participants ──────────────────────────────────────────────────────────

    router.get("/api/convos/conversations/:id/participants", (c) =>
        handle(c, async (c) => {
            c.body = await svc.getParticipants(ctx, sec(c), { conversationId: c.params.id });
        }),
    );

    // ── Notifications ─────────────────────────────────────────────────────────

    router.get("/api/convos/notifications", (c) =>
        handle(c, async (c) => {
            const userId = q(c, "userId") ?? sec(c).principalIri ?? "";
            const unreadOnly = q(c, "unreadOnly") === "true";
            c.body = await svc.getNotificationsForUser(ctx, sec(c), { userId, unreadOnly });
        }),
    );

    router.post("/api/convos/notifications/:id/read", (c) =>
        handle(c, async (c) => {
            c.body = await svc.markNotificationRead(ctx, sec(c), {
                notificationId: c.params.id,
            });
        }),
    );

    router.post("/api/convos/notifications/read-all", (c) =>
        handle(c, async (c) => {
            const userId = (body(c).userId as string | undefined) ?? sec(c).principalIri ?? "";
            c.body = { marked: await svc.markAllNotificationsRead(ctx, sec(c), { userId }) };
        }),
    );

    router.post("/api/convos/notifications/:id/dismiss", (c) =>
        handle(c, async (c) => {
            c.body = await svc.dismissNotification(ctx, sec(c), {
                notificationId: c.params.id,
            });
        }),
    );

    // ── Current user info ─────────────────────────────────────────────────────

    router.get("/api/convos/me", (c) =>
        handle(c, async (c) => {
            const s = sec(c);
            c.body = {
                iri: s.principalIri,
                authenticated: s.principalIri != null,
            };
        }),
    );
}
