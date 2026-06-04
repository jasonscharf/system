/**
 * Standalone service for programmatic notification delivery with deduplication.
 *
 * Deduplication policies:
 *
 *   one-time     — at most one delivery ever per (userId, templateKey).
 *   resettable   — like one-time, but dismissing resets the latch.
 *   window       — at most once per N hours.
 */

import type { SecurityContext, ServerContext } from "@jasonscharf/server";
import type { NotificationRepository } from "./repository/NotificationRepository.js";
import type { NotificationEntity, SendNotificationInput } from "./types.js";

export interface NotificationServiceOptions {
    notifications: NotificationRepository;
}

export interface SendToManyArgs {
    userIds: string[];
    input: Omit<SendNotificationInput, "userId">;
}

/** Identifies a (userId, templateKey) pair, shared by the history-query methods. */
export interface TemplateKeyArgs {
    userId: string;
    templateKey: string;
}

export interface WasSentWithinArgs {
    userId: string;
    templateKey: string;
    hours: number;
}

export class NotificationService {
    private readonly _notifications: NotificationRepository;

    constructor(opts: NotificationServiceOptions) {
        this._notifications = opts.notifications;
    }

    /**
     * Send a notification, subject to the supplied deduplication policy.
     * Returns the created notification, or `null` if the policy suppressed it.
     */
    async send(
        ctx: ServerContext,
        sec: SecurityContext,
        args: SendNotificationInput,
    ): Promise<NotificationEntity | null> {
        const suppressed = await this._isSuppressed(ctx, sec, args);
        if (suppressed) {
            return null;
        }

        return this._notifications.create(ctx, sec, {
            userId: args.userId,
            notifType: args.notifType ?? "insight",
            sourceIri: args.sourceIri,
            templateKey: args.templateKey,
            payload: args.payload,
        });
    }

    /**
     * Send the same notification to multiple users, applying the dedupe policy
     * independently per user.
     */
    async sendToMany(
        ctx: ServerContext,
        sec: SecurityContext,
        args: SendToManyArgs,
    ): Promise<NotificationEntity[]> {
        const created: NotificationEntity[] = [];

        for (const userId of args.userIds) {
            const result = await this.send(ctx, sec, { ...args.input, userId });
            if (result) {
                created.push(result);
            }
        }

        return created;
    }

    /**
     * True if a notification with this templateKey was sent to this user within
     * the last `hours` hours and has not been dismissed.
     */
    async wasSentWithin(
        ctx: ServerContext,
        sec: SecurityContext,
        args: WasSentWithinArgs,
    ): Promise<boolean> {
        const cutoff = new Date(Date.now() - args.hours * 3_600_000);
        const history = await this._notifications.findByTemplateKey(ctx, sec, {
            userId: args.userId,
            templateKey: args.templateKey,
        });
        return history.some((n) => !n.isDismissed && n.createdAt >= cutoff);
    }

    /**
     * True if a notification with this templateKey has EVER been sent to this user.
     */
    async wasSentEver(
        ctx: ServerContext,
        sec: SecurityContext,
        args: TemplateKeyArgs,
    ): Promise<boolean> {
        const history = await this._notifications.findByTemplateKey(ctx, sec, args);
        return history.length > 0;
    }

    /**
     * True if a non-dismissed notification with this templateKey exists for the user.
     */
    async hasPending(
        ctx: ServerContext,
        sec: SecurityContext,
        args: TemplateKeyArgs,
    ): Promise<boolean> {
        const history = await this._notifications.findByTemplateKey(ctx, sec, args);
        return history.some((n) => !n.isDismissed);
    }

    /** Full history for a (userId, templateKey) pair, newest first. */
    async history(
        ctx: ServerContext,
        sec: SecurityContext,
        args: TemplateKeyArgs,
    ): Promise<NotificationEntity[]> {
        return this._notifications.findByTemplateKey(ctx, sec, args);
    }

    // ── Deduplication logic ───────────────────────────────────────────────────

    private async _isSuppressed(
        ctx: ServerContext,
        sec: SecurityContext,
        input: SendNotificationInput,
    ): Promise<boolean> {
        const { userId, templateKey, dedupe } = input;

        if (dedupe.kind === "one-time") {
            return this.wasSentEver(ctx, sec, { userId, templateKey });
        }

        if (dedupe.kind === "resettable") {
            return this.hasPending(ctx, sec, { userId, templateKey });
        }

        if (dedupe.kind === "window") {
            return this.wasSentWithin(ctx, sec, { userId, templateKey, hours: dedupe.hours });
        }

        return false;
    }
}
