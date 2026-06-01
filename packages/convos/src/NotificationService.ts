/**
 * Standalone service for programmatic notification delivery with deduplication.
 *
 * Designed to be consumed by downstream packages (e.g. an "application
 * insights" extension) without taking a dependency on ConvoService or any
 * conversation / message infrastructure.  Requires only a NotificationRepository.
 *
 * Deduplication policies:
 *
 *   one-time     — at most one delivery ever per (userId, templateKey).
 *                  Dismissing does NOT reset the latch.  Use for "welcome
 *                  messages" and other truly once-only notifications.
 *
 *   resettable   — like one-time, but dismissing the notification resets the
 *                  latch so the next send() call delivers again.  Use when
 *                  "I'll look at this later" is a valid user action.
 *
 *   window       — at most once per N hours.  Dismissing always resets the
 *                  window.  Use for recurring digests or periodic alerts.
 *
 * Dismissed notifications are excluded from ALL window checks except
 * `one-time` mode, where a dismissed delivery still counts as "sent".
 *
 * Example usage (downstream package):
 *
 *   const svc = new NotificationService({ notifications: notifRepo });
 *
 *   // Welcome message — send exactly once, ever
 *   await svc.send(ctx, {
 *       userId: user.iri,
 *       templateKey: "insights:welcome",
 *       payload: { userName: user.displayName },
 *       dedupe: { kind: "one-time" },
 *   });
 *
 *   // Daily digest — send at most once per 24 h; dismiss resets
 *   await svc.send(ctx, {
 *       userId: user.iri,
 *       templateKey: "insights:daily-digest",
 *       payload: { activeUsers: 42, newSignups: 7 },
 *       dedupe: { kind: "window", hours: 24 },
 *   });
 */

import type { ServerContext } from "@jasonscharf/server";
import type { NotificationRepository } from "./repository/NotificationRepository.js";
import type { NotificationEntity, SendNotificationInput } from "./types.js";

export interface NotificationServiceOptions {
    notifications: NotificationRepository;
}

export class NotificationService {
    private readonly _notifications: NotificationRepository;

    constructor(opts: NotificationServiceOptions) {
        this._notifications = opts.notifications;
    }

    /**
     * Send a notification, subject to the supplied deduplication policy.
     *
     * Returns the created notification, or `null` if the policy suppressed it.
     */
    async send(
        ctx: ServerContext,
        input: SendNotificationInput,
    ): Promise<NotificationEntity | null> {
        const suppressed = await this._isSuppressed(ctx, input);
        if (suppressed) {
            return null;
        }

        return this._notifications.create(ctx, {
            userId: input.userId,
            notifType: input.notifType ?? "insight",
            sourceIri: input.sourceIri,
            templateKey: input.templateKey,
            payload: input.payload,
        });
    }

    /**
     * Send the same notification to multiple users, applying the dedupe policy
     * independently per user.  Returns only the notifications that were actually
     * created (suppressed ones are omitted).
     */
    async sendToMany(
        ctx: ServerContext,
        userIds: string[],
        input: Omit<SendNotificationInput, "userId">,
    ): Promise<NotificationEntity[]> {
        const created: NotificationEntity[] = [];

        for (const userId of userIds) {
            const result = await this.send(ctx, { ...input, userId });
            if (result) {
                created.push(result);
            }
        }

        return created;
    }

    /**
     * True if a notification with this templateKey was sent to this user within
     * the last `hours` hours and has not been dismissed.
     *
     * Dismissed notifications do NOT count — use this to test the "window" policy.
     */
    async wasSentWithin(
        ctx: ServerContext,
        userId: string,
        templateKey: string,
        hours: number,
    ): Promise<boolean> {
        const cutoff = new Date(Date.now() - hours * 3_600_000);
        const history = await this._notifications.findByTemplateKey(ctx, userId, templateKey);
        return history.some((n) => !n.isDismissed && n.createdAt >= cutoff);
    }

    /**
     * True if a notification with this templateKey has EVER been sent to this
     * user, regardless of read/dismissed state.  Use this to test "one-time".
     */
    async wasSentEver(ctx: ServerContext, userId: string, templateKey: string): Promise<boolean> {
        const history = await this._notifications.findByTemplateKey(ctx, userId, templateKey);
        return history.length > 0;
    }

    /**
     * True if a non-dismissed notification with this templateKey exists for the
     * user.  Use this to test "resettable" (sent AND not yet dismissed).
     */
    async hasPending(ctx: ServerContext, userId: string, templateKey: string): Promise<boolean> {
        const history = await this._notifications.findByTemplateKey(ctx, userId, templateKey);
        return history.some((n) => !n.isDismissed);
    }

    /** Full history for a (userId, templateKey) pair, newest first. */
    async history(
        ctx: ServerContext,
        userId: string,
        templateKey: string,
    ): Promise<NotificationEntity[]> {
        return this._notifications.findByTemplateKey(ctx, userId, templateKey);
    }

    // ── Deduplication logic ───────────────────────────────────────────────────

    private async _isSuppressed(
        ctx: ServerContext,
        input: SendNotificationInput,
    ): Promise<boolean> {
        const { userId, templateKey, dedupe } = input;

        if (dedupe.kind === "one-time") {
            // Suppress if any notification with this key was ever created,
            // regardless of whether it was dismissed.
            return this.wasSentEver(ctx, userId, templateKey);
        }

        if (dedupe.kind === "resettable") {
            // Suppress only when there is a non-dismissed notification pending.
            // Once the user dismisses, the latch resets and the next send goes through.
            return this.hasPending(ctx, userId, templateKey);
        }

        if (dedupe.kind === "window") {
            // Suppress if a non-dismissed notification was created within the window.
            return this.wasSentWithin(ctx, userId, templateKey, dedupe.hours);
        }

        // Unreachable — TypeScript exhaustiveness guard
        return false;
    }
}
