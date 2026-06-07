import { IRI, literal, type Quad } from "@jasonscharf/core";
import type { EntityTimestamps, TripleStore } from "@jasonscharf/data";
import type { SecurityContext, ServerContext } from "@jasonscharf/server";
import {
    CONVOS_GRAPH,
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

    constructor(store: TripleStore) {
        this._store = store;
    }

    /** @insecure @nochecks */
    async create(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: CreateNotificationInput,
    ): Promise<NotificationEntity> {
        const id = newId();
        const sub = iriFor("notification", id);

        return this._store.withTransaction(ctx, async (ctx) => {
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
                    object: new IRI(args.userId),
                    graph: CONVOS_GRAPH,
                },
                {
                    subject: sub,
                    predicate: notifTypeIRI,
                    object: literal(args.notifType, XSD_STRING),
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
            ];

            if (args.sourceIri) {
                quads.push({
                    subject: sub,
                    predicate: sourceIriIRI,
                    object: literal(args.sourceIri, XSD_STRING),
                    graph: CONVOS_GRAPH,
                });
            }

            if (args.templateKey) {
                quads.push({
                    subject: sub,
                    predicate: templateKeyIRI,
                    object: literal(args.templateKey, XSD_STRING),
                    graph: CONVOS_GRAPH,
                });
            }

            if (args.payload) {
                quads.push({
                    subject: sub,
                    predicate: payloadIRI,
                    object: literal(JSON.stringify(args.payload), XSD_STRING),
                    graph: CONVOS_GRAPH,
                });
            }

            await this._store.insertMany(ctx, quads);

            const ts = await this._timestamps(ctx, sub);
            return {
                id,
                iri: sub.value,
                userId: args.userId,
                notifType: args.notifType,
                sourceIri: args.sourceIri,
                templateKey: args.templateKey,
                payload: args.payload ? JSON.stringify(args.payload) : undefined,
                isRead: false,
                isDismissed: false,
                createdAt: ts.createdAt,
            };
        });
    }

    /** @insecure @nochecks */
    async findById(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: IdArgs,
    ): Promise<NotificationEntity | null> {
        const sub = iriFor("notification", args.id);
        const quads = await this._store.find(ctx, { subject: sub, graph: CONVOS_GRAPH });
        return quads.length === 0
            ? null
            : this._fromQuads(args.id, quads, await this._timestamps(ctx, sub));
    }

    /** @insecure @nochecks */
    async findByUser(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: FindByUserArgs,
    ): Promise<NotificationEntity[]> {
        const quads = await this._store.find(ctx, {
            predicate: notifUserIRI,
            object: new IRI(args.userId),
            graph: CONVOS_GRAPH,
        });

        if (quads.length === 0) {
            return [];
        }

        const subjects = quads.map((q) => q.subject as IRI);
        const bySubject = await this._store.findForSubjects(ctx, subjects, CONVOS_GRAPH);
        const tsBySubject = await this._store.entityTimestamps(ctx, subjects, CONVOS_GRAPH);

        const notifications: NotificationEntity[] = [];
        for (const [subjIri, all] of bySubject) {
            if (all.length === 0) {
                continue;
            }
            const n = this._fromQuads(
                idFrom(subjIri),
                all,
                tsBySubject.get(subjIri) ?? this._now(),
            );
            if (args.unreadOnly && n.isRead) {
                continue;
            }
            notifications.push(n);
        }

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
        const quads = await this._store.find(ctx, {
            predicate: templateKeyIRI,
            object: literal(args.templateKey, XSD_STRING),
            graph: CONVOS_GRAPH,
        });

        if (quads.length === 0) {
            return [];
        }

        const subjects = quads.map((q) => q.subject as IRI);
        const bySubject = await this._store.findForSubjects(ctx, subjects, CONVOS_GRAPH);
        const tsBySubject = await this._store.entityTimestamps(ctx, subjects, CONVOS_GRAPH);

        const results: NotificationEntity[] = [];
        for (const [subjIri, all] of bySubject) {
            if (all.length === 0) {
                continue;
            }
            const entity = this._fromQuads(
                idFrom(subjIri),
                all,
                tsBySubject.get(subjIri) ?? this._now(),
            );
            if (entity.userId === args.userId) {
                results.push(entity);
            }
        }

        results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return results;
    }

    /** @insecure @nochecks */
    async countUnread(
        ctx: ServerContext,
        sec: SecurityContext,
        args: UserIdArgs,
    ): Promise<number> {
        const all = await this.findByUser(ctx, sec, { userId: args.userId, unreadOnly: true });
        return all.filter((n) => !n.isDismissed).length;
    }

    /** @insecure @nochecks */
    async markRead(
        ctx: ServerContext,
        sec: SecurityContext,
        args: IdArgs,
    ): Promise<NotificationEntity | null> {
        return this._setBooleanFlag(ctx, sec, args.id, isReadIRI, true);
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
        return this._setBooleanFlag(ctx, sec, args.id, isDismissedIRI, true);
    }

    /** @insecure @nochecks Fan-out: create a notification for each recipient, skipping the excluded user. */
    async fanOut(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: FanOutArgs,
    ): Promise<NotificationEntity[]> {
        return this._store.withTransaction(ctx, async (ctx) => {
            const pending: { sub: IRI; userId: string }[] = [];
            const allQuads: Quad[] = [];

            for (const userId of args.recipientIds) {
                if (userId === args.excludeUserId) {
                    continue;
                }
                const id = newId();
                const sub = iriFor("notification", id);
                pending.push({ sub, userId });

                allQuads.push(
                    {
                        subject: sub,
                        predicate: RDF_TYPE,
                        object: NotificationClassIRI,
                        graph: CONVOS_GRAPH,
                    },
                    {
                        subject: sub,
                        predicate: notifUserIRI,
                        object: new IRI(userId),
                        graph: CONVOS_GRAPH,
                    },
                    {
                        subject: sub,
                        predicate: notifTypeIRI,
                        object: literal(args.notifType, XSD_STRING),
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
                        predicate: sourceIriIRI,
                        object: literal(args.sourceIri, XSD_STRING),
                        graph: CONVOS_GRAPH,
                    },
                );
            }

            if (allQuads.length === 0) {
                return [];
            }

            await this._store.insertMany(ctx, allQuads);

            const tsBySubject = await this._store.entityTimestamps(
                ctx,
                pending.map((p) => p.sub),
                CONVOS_GRAPH,
            );

            return pending.map(({ sub, userId }) => ({
                id: idFrom(sub.value),
                iri: sub.value,
                userId,
                notifType: args.notifType,
                sourceIri: args.sourceIri,
                templateKey: undefined,
                payload: undefined,
                isRead: false,
                isDismissed: false,
                createdAt: (tsBySubject.get(sub.value) ?? this._now()).createdAt,
            }));
        });
    }

    private async _setBooleanFlag(
        ctx: ServerContext,
        _sec: SecurityContext,
        id: string,
        predicate: IRI,
        value: boolean,
    ): Promise<NotificationEntity | null> {
        return this._store.withTransaction(ctx, async (ctx) => {
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
            return this._fromQuads(id, updated, await this._timestamps(ctx, sub));
        });
    }

    private _now(): EntityTimestamps {
        const now = new Date();
        return { createdAt: now, updatedAt: now };
    }

    /** Entity-level timestamps from the store's DB-managed edge columns (not triples). */
    private async _timestamps(ctx: ServerContext, sub: IRI): Promise<EntityTimestamps> {
        return (
            (await this._store.entityTimestamps(ctx, [sub], CONVOS_GRAPH)).get(sub.value) ??
            this._now()
        );
    }

    private _fromQuads(
        id: string,
        quads: Awaited<ReturnType<TripleStore["find"]>>,
        ts: EntityTimestamps,
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
            createdAt: ts.createdAt,
        };
    }
}
