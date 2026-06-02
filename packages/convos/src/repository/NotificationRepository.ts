import { IRI, literal, type Quad } from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { ServerContext } from "@jasonscharf/server";
import {
    CONVOS_GRAPH,
    convosCreatedAtIRI,
    isDismissedIRI,
    isReadIRI,
    NotificationClassIRI,
    notifTypeIRI,
    notifUserIRI,
    payloadIRI,
    RDF_TYPE,
    sourceIriIRI,
    templateKeyIRI,
    XSD_BOOLEAN,
    XSD_DATETIME,
    XSD_STRING,
} from "../constants.js";
import type { NotificationEntity, NotificationType } from "../types.js";
import { idFrom, iriFor, iriValue, literalValue, newId } from "./util.js";

export interface CreateNotificationInput {
    userId: string;
    notifType: NotificationType;
    sourceIri?: string;
    templateKey?: string;
    payload?: Record<string, unknown>;
}

export class NotificationRepository {
    private readonly _store: TripleStore;

    constructor(store: TripleStore) {
        this._store = store;
    }

    async create(ctx: ServerContext, input: CreateNotificationInput): Promise<NotificationEntity> {
        const id = newId();
        const now = new Date();
        const sub = iriFor("notification", id);

        const quads = [
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
        ];

        if (input.sourceIri) {
            quads.push({
                subject: sub,
                predicate: sourceIriIRI,
                object: literal(input.sourceIri, XSD_STRING),
                graph: CONVOS_GRAPH,
            });
        }

        if (input.templateKey) {
            quads.push({
                subject: sub,
                predicate: templateKeyIRI,
                object: literal(input.templateKey, XSD_STRING),
                graph: CONVOS_GRAPH,
            });
        }

        if (input.payload) {
            quads.push({
                subject: sub,
                predicate: payloadIRI,
                object: literal(JSON.stringify(input.payload), XSD_STRING),
                graph: CONVOS_GRAPH,
            });
        }

        await this._store.insertMany(ctx, quads);

        return {
            id,
            iri: sub.value,
            userId: input.userId,
            notifType: input.notifType,
            sourceIri: input.sourceIri,
            templateKey: input.templateKey,
            payload: input.payload ? JSON.stringify(input.payload) : undefined,
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

        if (quads.length === 0) {
            return [];
        }

        const subjects = quads.map((q) => q.subject as IRI);
        const bySubject = await this._store.findForSubjects(ctx, subjects, CONVOS_GRAPH);

        const notifications: NotificationEntity[] = [];
        for (const [subjIri, all] of bySubject) {
            if (all.length === 0) {
                continue;
            }
            const n = this._fromQuads(idFrom(subjIri), all);
            if (opts.unreadOnly && n.isRead) {
                continue;
            }
            notifications.push(n);
        }

        notifications.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return notifications;
    }

    /**
     * Return all notifications for a user with the given templateKey.
     * Used by NotificationService to evaluate deduplication policies.
     */
    async findByTemplateKey(
        ctx: ServerContext,
        userId: string,
        templateKey: string,
    ): Promise<NotificationEntity[]> {
        const quads = await this._store.find(ctx, {
            predicate: templateKeyIRI,
            object: literal(templateKey, XSD_STRING),
            graph: CONVOS_GRAPH,
        });

        if (quads.length === 0) {
            return [];
        }

        const subjects = quads.map((q) => q.subject as IRI);
        const bySubject = await this._store.findForSubjects(ctx, subjects, CONVOS_GRAPH);

        const results: NotificationEntity[] = [];
        for (const [subjIri, all] of bySubject) {
            if (all.length === 0) {
                continue;
            }
            const entity = this._fromQuads(idFrom(subjIri), all);
            if (entity.userId === userId) {
                results.push(entity);
            }
        }

        results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return results;
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
        await Promise.all(unread.map((n) => this.markRead(ctx, n.id)));
        return unread.length;
    }

    async dismiss(ctx: ServerContext, id: string): Promise<NotificationEntity | null> {
        return this._setBooleanFlag(ctx, id, isDismissedIRI, true);
    }

    /** Fan-out: create a notification for each recipient, skipping the excluded user. */
    async fanOut(
        ctx: ServerContext,
        recipientIds: string[],
        sourceIri: string,
        notifType: NotificationType,
        excludeUserId?: string,
    ): Promise<NotificationEntity[]> {
        const now = new Date();
        const created: NotificationEntity[] = [];
        const allQuads: Quad[] = [];

        for (const userId of recipientIds) {
            if (userId === excludeUserId) {
                continue;
            }
            const id = newId();
            const sub = iriFor("notification", id);

            allQuads.push(
                { subject: sub, predicate: RDF_TYPE, object: NotificationClassIRI, graph: CONVOS_GRAPH },
                { subject: sub, predicate: notifUserIRI, object: new IRI(userId), graph: CONVOS_GRAPH },
                { subject: sub, predicate: notifTypeIRI, object: literal(notifType, XSD_STRING), graph: CONVOS_GRAPH },
                { subject: sub, predicate: isReadIRI, object: literal("false", XSD_BOOLEAN), graph: CONVOS_GRAPH },
                { subject: sub, predicate: isDismissedIRI, object: literal("false", XSD_BOOLEAN), graph: CONVOS_GRAPH },
                { subject: sub, predicate: convosCreatedAtIRI, object: literal(now.toISOString(), XSD_DATETIME), graph: CONVOS_GRAPH },
                { subject: sub, predicate: sourceIriIRI, object: literal(sourceIri, XSD_STRING), graph: CONVOS_GRAPH },
            );

            created.push({
                id,
                iri: sub.value,
                userId,
                notifType,
                sourceIri,
                templateKey: undefined,
                payload: undefined,
                isRead: false,
                isDismissed: false,
                createdAt: now,
            });
        }

        if (allQuads.length > 0) {
            await this._store.insertMany(ctx, allQuads);
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
            sourceIri: getLit(sourceIriIRI),
            templateKey: getLit(templateKeyIRI),
            payload: getLit(payloadIRI),
            isRead: isReadStr === "true",
            isDismissed: isDismissedStr === "true",
            createdAt: new Date(createdAtStr),
        };
    }
}
