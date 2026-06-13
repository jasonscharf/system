import type { TripleStore } from "@jasonscharf/data";
import type { EntityRecord } from "@jasonscharf/entities";
import type { SecurityContext, ServerContext } from "@jasonscharf/server";
import { EntityQuery, EntityStore } from "@jasonscharf/server";
import { NotificationSchema } from "../entities/NotificationSchema.js";
import type { NotificationEntity, NotificationType } from "../types.js";
import { newId } from "./util.js";

export interface CreateNotificationInput {
    userId: string;
    notifType: NotificationType;
    sourceIri?: string;
    templateKey?: string;
    payload?: Record<string, unknown>;
}

export interface IdArgs {
    id: string;
}

export interface FindByUserArgs {
    userId: string;
    unreadOnly?: boolean;
}

export interface TemplateKeyArgs {
    userId: string;
    templateKey: string;
}

export interface UserIdArgs {
    userId: string;
}

export interface FanOutArgs {
    recipientIds: string[];
    sourceIri: string;
    notifType: NotificationType;
    excludeUserId?: string;
}

export class NotificationRepository {
    private readonly _store: TripleStore;
    private readonly _entities: EntityStore;

    constructor(store: TripleStore) {
        this._store = store;
        this._entities = new EntityStore(store);
    }

    get store(): TripleStore {
        return this._store;
    }

    /** @insecure @nochecks */
    async create(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: CreateNotificationInput,
    ): Promise<NotificationEntity> {
        const record = await this._entities.create(
            ctx,
            NotificationSchema,
            {
                notifUser: args.userId,
                notifType: args.notifType,
                isRead: false,
                isDismissed: false,
                sourceIri: args.sourceIri,
                templateKey: args.templateKey,
                payload: args.payload ? JSON.stringify(args.payload) : undefined,
            },
            newId(),
        );
        return this._toEntity(record);
    }

    /** @insecure @nochecks */
    async findById(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: IdArgs,
    ): Promise<NotificationEntity | null> {
        const record = await this._entities.findById(ctx, NotificationSchema, args.id);
        return record ? this._toEntity(record) : null;
    }

    /** @insecure @nochecks */
    async findByUser(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: FindByUserArgs,
    ): Promise<NotificationEntity[]> {
        const records = await EntityQuery.from(this._store, NotificationSchema)
            .where("notifUser", "=", args.userId)
            .all(ctx);
        const notifications = records
            .map((r) => this._toEntity(r))
            .filter((n) => !(args.unreadOnly && n.isRead));
        notifications.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return notifications;
    }

    /**
     * @insecure @nochecks
     * Return all notifications for a user with the given templateKey.
     * Used by NotificationService to evaluate deduplication policies.
     */
    async findByTemplateKey(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: TemplateKeyArgs,
    ): Promise<NotificationEntity[]> {
        const records = await EntityQuery.from(this._store, NotificationSchema)
            .where("templateKey", "=", args.templateKey)
            .all(ctx);
        const results = records
            .map((r) => this._toEntity(r))
            .filter((n) => n.userId === args.userId);
        results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return results;
    }

    /** @insecure @nochecks */
    async countUnread(ctx: ServerContext, sec: SecurityContext, args: UserIdArgs): Promise<number> {
        const all = await this.findByUser(ctx, sec, { userId: args.userId, unreadOnly: true });
        return all.filter((n) => !n.isDismissed).length;
    }

    /** @insecure @nochecks */
    async markRead(
        ctx: ServerContext,
        sec: SecurityContext,
        args: IdArgs,
    ): Promise<NotificationEntity | null> {
        return this._setBooleanFlag(ctx, sec, args.id, "isRead", true);
    }

    /** @insecure @nochecks */
    async markAllReadForUser(
        ctx: ServerContext,
        sec: SecurityContext,
        args: UserIdArgs,
    ): Promise<number> {
        const unread = await this.findByUser(ctx, sec, {
            userId: args.userId,
            unreadOnly: true,
        });
        await Promise.all(unread.map((n) => this.markRead(ctx, sec, { id: n.id })));
        return unread.length;
    }

    /** @insecure @nochecks */
    async dismiss(
        ctx: ServerContext,
        sec: SecurityContext,
        args: IdArgs,
    ): Promise<NotificationEntity | null> {
        return this._setBooleanFlag(ctx, sec, args.id, "isDismissed", true);
    }

    /** @insecure @nochecks Fan-out: create a notification for each recipient, skipping the excluded user. */
    async fanOut(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: FanOutArgs,
    ): Promise<NotificationEntity[]> {
        return this._store.withTransaction(ctx, async (ctx) => {
            const recipients = args.recipientIds.filter((userId) => userId !== args.excludeUserId);

            const notifications: NotificationEntity[] = [];
            for (const userId of recipients) {
                const record = await this._entities.create(
                    ctx,
                    NotificationSchema,
                    {
                        notifUser: userId,
                        notifType: args.notifType,
                        isRead: false,
                        isDismissed: false,
                        sourceIri: args.sourceIri,
                    },
                    newId(),
                );
                notifications.push(this._toEntity(record));
            }
            return notifications;
        });
    }

    private async _setBooleanFlag(
        ctx: ServerContext,
        _sec: SecurityContext,
        id: string,
        prop: "isRead" | "isDismissed",
        value: boolean,
    ): Promise<NotificationEntity | null> {
        return this._store.withTransaction(ctx, async (ctx) => {
            const record = await this._entities.findById(ctx, NotificationSchema, id);
            if (!record) {
                return null;
            }
            await this._entities.update(ctx, NotificationSchema, id, { [prop]: value });
            const updated = await this._entities.findById(ctx, NotificationSchema, id);
            return updated ? this._toEntity(updated) : null;
        });
    }

    private _toEntity(record: EntityRecord): NotificationEntity {
        const user = record.props.notifUser;
        if (user == null) {
            throw new Error(`NotificationRepository: missing user for id "${record.id}"`);
        }
        const notifType = record.props.notifType;
        if (notifType == null) {
            throw new Error(`NotificationRepository: missing notifType for id "${record.id}"`);
        }

        const sourceIri = record.props.sourceIri;
        const templateKey = record.props.templateKey;
        const payload = record.props.payload;

        return {
            id: record.id,
            iri: record.iri,
            userId: String(user),
            notifType: String(notifType) as NotificationType,
            sourceIri: sourceIri != null ? String(sourceIri) : undefined,
            templateKey: templateKey != null ? String(templateKey) : undefined,
            payload: payload != null ? String(payload) : undefined,
            isRead: record.props.isRead === true,
            isDismissed: record.props.isDismissed === true,
            createdAt: record.createdAt ?? new Date(),
        };
    }
}
