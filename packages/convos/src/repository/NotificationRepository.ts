import { IRI, literal } from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { ServerContext } from "@jasonscharf/server";
import {
    CONVOS_GRAPH,
    convosCreatedAtIRI,
    isDismissedIRI,
    isReadIRI,
    notifTypeIRI,
    notifUserIRI,
    NotificationClassIRI,
    RDF_TYPE,
    sourceIriIRI,
    XSD_BOOLEAN,
    XSD_DATETIME,
    XSD_STRING,
} from "../constants.js";
import type { NotificationEntity, NotificationType } from "../types.js";
import { idFrom, iriFor, iriValue, literalValue, newId } from "./util.js";

export class NotificationRepository {
    private readonly _store: TripleStore;

    constructor(store: TripleStore) {
        this._store = store;
    }

    async create(
        ctx: ServerContext,
        input: Pick<NotificationEntity, "userId" | "notifType" | "sourceIri">,
    ): Promise<NotificationEntity> {
        const id = newId();
        const now = new Date();
        const sub = iriFor("notification", id);

        await this._store.insertMany(ctx, [
            {
                subject: sub,
                predicate: RDF_TYPE,
                object: NotificationClassIRI,
                graph: CONVOS_GRAPH,
            },
            {
                subject: sub,
                predicate: notifUserIRI,
                object: new IRI(input.userId),
                graph: CONVOS_GRAPH,
            },
            {
                subject: sub,
                predicate: notifTypeIRI,
                object: literal(input.notifType, XSD_STRING),
                graph: CONVOS_GRAPH,
            },
            {
                subject: sub,
                predicate: sourceIriIRI,
                object: literal(input.sourceIri, XSD_STRING),
                graph: CONVOS_GRAPH,
            },
            {
                subject: sub,
                predicate: isReadIRI,
                object: literal("false", XSD_BOOLEAN),
                graph: CONVOS_GRAPH,
            },
            {
                subject: sub,
                predicate: isDismissedIRI,
                object: literal("false", XSD_BOOLEAN),
                graph: CONVOS_GRAPH,
            },
            {
                subject: sub,
                predicate: convosCreatedAtIRI,
                object: literal(now.toISOString(), XSD_DATETIME),
                graph: CONVOS_GRAPH,
            },
        ]);

        return {
            id,
            iri: sub.value,
            userId: input.userId,
            notifType: input.notifType,
            sourceIri: input.sourceIri,
            isRead: false,
            isDismissed: false,
            createdAt: now,
        };
    }

    async findById(ctx: ServerContext, id: string): Promise<NotificationEntity | null> {
        const sub = iriFor("notification", id);
        const quads = await this._store.find(ctx, { subject: sub, graph: CONVOS_GRAPH });
        return quads.length === 0 ? null : this._fromQuads(id, quads);
    }

    async findByUser(
        ctx: ServerContext,
        userId: string,
        opts: { unreadOnly?: boolean } = {},
    ): Promise<NotificationEntity[]> {
        const quads = await this._store.find(ctx, {
            predicate: notifUserIRI,
            object: new IRI(userId),
            graph: CONVOS_GRAPH,
        });

        const notifications: NotificationEntity[] = [];

        for (const q of quads) {
            const nid = idFrom((q.subject as IRI).value);
            const all = await this._store.find(ctx, {
                subject: q.subject as IRI,
                graph: CONVOS_GRAPH,
            });
            if (all.length > 0) {
                const n = this._fromQuads(nid, all);
                if (opts.unreadOnly && n.isRead) {
                    continue;
                }
                notifications.push(n);
            }
        }

        notifications.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return notifications;
    }

    async countUnread(ctx: ServerContext, userId: string): Promise<number> {
        const all = await this.findByUser(ctx, userId, { unreadOnly: true });
        return all.filter((n) => !n.isDismissed).length;
    }

    async markRead(ctx: ServerContext, id: string): Promise<NotificationEntity | null> {
        return this._setBooleanFlag(ctx, id, isReadIRI, true);
    }

    async markAllReadForUser(ctx: ServerContext, userId: string): Promise<number> {
        const unread = await this.findByUser(ctx, userId, { unreadOnly: true });
        let count = 0;

        for (const n of unread) {
            await this.markRead(ctx, n.id);
            count++;
        }

        return count;
    }

    async dismiss(ctx: ServerContext, id: string): Promise<NotificationEntity | null> {
        return this._setBooleanFlag(ctx, id, isDismissedIRI, true);
    }

    /** Fan-out: create a notification for each recipient, skipping the author. */
    async fanOut(
        ctx: ServerContext,
        recipientIds: string[],
        sourceIri: string,
        notifType: NotificationType,
        excludeUserId?: string,
    ): Promise<NotificationEntity[]> {
        const created: NotificationEntity[] = [];

        for (const userId of recipientIds) {
            if (userId === excludeUserId) {
                continue;
            }
            const n = await this.create(ctx, { userId, notifType, sourceIri });
            created.push(n);
        }

        return created;
    }

    private async _setBooleanFlag(
        ctx: ServerContext,
        id: string,
        predicate: IRI,
        value: boolean,
    ): Promise<NotificationEntity | null> {
        const sub = iriFor("notification", id);
        const quads = await this._store.find(ctx, { subject: sub, graph: CONVOS_GRAPH });
        if (quads.length === 0) {
            return null;
        }

        await this._store.delete(ctx, { subject: sub, predicate, graph: CONVOS_GRAPH });
        await this._store.insert(ctx, {
            subject: sub,
            predicate,
            object: literal(String(value), XSD_BOOLEAN),
            graph: CONVOS_GRAPH,
        });

        const updated = await this._store.find(ctx, { subject: sub, graph: CONVOS_GRAPH });
        return this._fromQuads(id, updated);
    }

    private _fromQuads(
        id: string,
        quads: Awaited<ReturnType<TripleStore["find"]>>,
    ): NotificationEntity {
        const getLit = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? literalValue(q.object) : undefined;
        };
        const getIri = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? iriValue(q.object) : undefined;
        };

        const userIri = getIri(notifUserIRI);
        if (userIri == null) {
            throw new Error(`NotificationRepository: missing user for id "${id}"`);
        }
        const notifType = getLit(notifTypeIRI);
        if (notifType == null) {
            throw new Error(`NotificationRepository: missing notifType for id "${id}"`);
        }
        const sourceIri = getLit(sourceIriIRI);
        if (sourceIri == null) {
            throw new Error(`NotificationRepository: missing sourceIri for id "${id}"`);
        }
        const createdAtStr = getLit(convosCreatedAtIRI);
        if (createdAtStr == null) {
            throw new Error(`NotificationRepository: missing createdAt for id "${id}"`);
        }

        const isReadStr = getLit(isReadIRI) ?? "false";
        const isDismissedStr = getLit(isDismissedIRI) ?? "false";

        return {
            id,
            iri: iriFor("notification", id).value,
            userId: userIri,
            notifType: notifType as NotificationType,
            sourceIri,
            isRead: isReadStr === "true",
            isDismissed: isDismissedStr === "true",
            createdAt: new Date(createdAtStr),
        };
    }
}
