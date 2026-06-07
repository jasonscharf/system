import { IRI, literal } from "@jasonscharf/core";
import type { EntityTimestamps, TripleStore } from "@jasonscharf/data";
import type { SecurityContext, ServerContext } from "@jasonscharf/server";
import {
    authorIRI,
    CONVOS_GRAPH,
    contentIRI,
    contentTypeIRI,
    conversationRefIRI,
    editedAtIRI,
    editedByIRI,
    isDeletedIRI,
    MessageClassIRI,
    MessageRevisionClassIRI,
    messageRefIRI,
    RDF_TYPE,
    replyToIRI,
    revisionCountIRI,
    revisionIRI,
    XSD_BOOLEAN,
    XSD_DATETIME,
    XSD_INTEGER,
    XSD_STRING,
} from "../constants.js";
import type { ContentType, MessageEntity, MessageRevisionEntity } from "../types.js";
import { idFrom, iriFor, iriValue, literalValue, newId } from "./util.js";

export interface IdArgs {
    id: string;
}

export interface ConversationIdArgs {
    conversationId: string;
}

export interface EditMessageArgs {
    id: string;
    newContent: string;
    editorId: string;
}

export interface MessageIdArgs {
    messageId: string;
}

export class MessageRepository {
    private readonly _store: TripleStore;

    constructor(store: TripleStore) {
        this._store = store;
    }

    /** @insecure @nochecks */
    async create(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: Pick<MessageEntity, "conversationId" | "authorId" | "content" | "contentType"> & {
            replyToId?: string;
        },
    ): Promise<MessageEntity> {
        const id = newId();
        const sub = iriFor("message", id);

        return this._store.withTransaction(ctx, async (ctx) => {
            const quads = [
                { subject: sub, predicate: RDF_TYPE, object: MessageClassIRI, graph: CONVOS_GRAPH },
                {
                    subject: sub,
                    predicate: conversationRefIRI,
                    object: iriFor("conversation", args.conversationId),
                    graph: CONVOS_GRAPH,
                },
                {
                    subject: sub,
                    predicate: authorIRI,
                    object: new IRI(args.authorId),
                    graph: CONVOS_GRAPH,
                },
                {
                    subject: sub,
                    predicate: contentIRI,
                    object: literal(args.content, XSD_STRING),
                    graph: CONVOS_GRAPH,
                },
                {
                    subject: sub,
                    predicate: contentTypeIRI,
                    object: literal(args.contentType, XSD_STRING),
                    graph: CONVOS_GRAPH,
                },
                {
                    subject: sub,
                    predicate: isDeletedIRI,
                    object: literal("false", XSD_BOOLEAN),
                    graph: CONVOS_GRAPH,
                },
                {
                    subject: sub,
                    predicate: revisionCountIRI,
                    object: literal("0", XSD_INTEGER),
                    graph: CONVOS_GRAPH,
                },
            ];

            if (args.replyToId) {
                quads.push({
                    subject: sub,
                    predicate: replyToIRI,
                    object: iriFor("message", args.replyToId),
                    graph: CONVOS_GRAPH,
                });
            }

            await this._store.insertMany(ctx, quads);

            const ts = await this._timestamps(ctx, sub);
            return {
                id,
                iri: sub.value,
                conversationId: args.conversationId,
                replyToId: args.replyToId ?? null,
                authorId: args.authorId,
                content: args.content,
                contentType: args.contentType,
                isDeleted: false,
                revisionCount: 0,
                createdAt: ts.createdAt,
                updatedAt: ts.updatedAt,
            };
        });
    }

    /** @insecure @nochecks */
    async findById(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: IdArgs,
    ): Promise<MessageEntity | null> {
        const sub = iriFor("message", args.id);
        const quads = await this._store.find(ctx, { subject: sub, graph: CONVOS_GRAPH });
        return quads.length === 0
            ? null
            : this._fromQuads(args.id, quads, await this._timestamps(ctx, sub));
    }

    /** @insecure @nochecks */
    async findByConversation(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: ConversationIdArgs,
    ): Promise<MessageEntity[]> {
        const quads = await this._store.find(ctx, {
            predicate: conversationRefIRI,
            object: iriFor("conversation", args.conversationId),
            graph: CONVOS_GRAPH,
        });

        const subjects = quads
            .map((q) => q.subject as IRI)
            .filter((s) => s.value.includes(":message:"));
        const tsBySubject = await this._store.entityTimestamps(ctx, subjects, CONVOS_GRAPH);
        const messages: MessageEntity[] = [];

        for (const sub of subjects) {
            const msgId = idFrom(sub.value);
            const all = await this._store.find(ctx, { subject: sub, graph: CONVOS_GRAPH });
            if (all.length > 0) {
                messages.push(
                    this._fromQuads(msgId, all, tsBySubject.get(sub.value) ?? this._now()),
                );
            }
        }

        messages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return messages;
    }

    /** @insecure @nochecks */
    async edit(
        ctx: ServerContext,
        sec: SecurityContext,
        args: EditMessageArgs,
    ): Promise<{ message: MessageEntity; revision: MessageRevisionEntity } | null> {
        return this._store.withTransaction(ctx, async (ctx) => {
            const existing = await this.findById(ctx, sec, { id: args.id });
            if (!existing || existing.isDeleted) {
                return null;
            }

            const sub = iriFor("message", args.id);
            const now = new Date();
            const nextRevision = existing.revisionCount + 1;

            // Save revision snapshot before overwriting
            const revId = newId();
            const revSub = iriFor("revision", revId);
            await this._store.insertMany(ctx, [
                {
                    subject: revSub,
                    predicate: RDF_TYPE,
                    object: MessageRevisionClassIRI,
                    graph: CONVOS_GRAPH,
                },
                {
                    subject: revSub,
                    predicate: messageRefIRI,
                    object: sub,
                    graph: CONVOS_GRAPH,
                },
                {
                    subject: revSub,
                    predicate: contentIRI,
                    object: literal(existing.content, XSD_STRING),
                    graph: CONVOS_GRAPH,
                },
                {
                    subject: revSub,
                    predicate: revisionIRI,
                    object: literal(String(existing.revisionCount), XSD_INTEGER),
                    graph: CONVOS_GRAPH,
                },
                {
                    subject: revSub,
                    predicate: editedByIRI,
                    object: new IRI(args.editorId),
                    graph: CONVOS_GRAPH,
                },
                {
                    subject: revSub,
                    predicate: editedAtIRI,
                    object: literal(now.toISOString(), XSD_DATETIME),
                    graph: CONVOS_GRAPH,
                },
            ]);

            await this._store.delete(ctx, {
                subject: sub,
                predicate: contentIRI,
                graph: CONVOS_GRAPH,
            });
            await this._store.insert(ctx, {
                subject: sub,
                predicate: contentIRI,
                object: literal(args.newContent, XSD_STRING),
                graph: CONVOS_GRAPH,
            });

            await this._store.delete(ctx, {
                subject: sub,
                predicate: revisionCountIRI,
                graph: CONVOS_GRAPH,
            });
            await this._store.insert(ctx, {
                subject: sub,
                predicate: revisionCountIRI,
                object: literal(String(nextRevision), XSD_INTEGER),
                graph: CONVOS_GRAPH,
            });

            const updated = await this.findById(ctx, sec, { id: args.id });
            if (!updated) {
                throw new Error(`MessageRepository: message ${args.id} vanished after edit`);
            }

            return {
                message: updated,
                revision: {
                    id: revId,
                    iri: revSub.value,
                    messageId: args.id,
                    content: existing.content,
                    revision: existing.revisionCount,
                    editedBy: args.editorId,
                    editedAt: now,
                },
            };
        });
    }

    /** @insecure @nochecks */
    async softDelete(
        ctx: ServerContext,
        sec: SecurityContext,
        args: IdArgs,
    ): Promise<MessageEntity | null> {
        return this._store.withTransaction(ctx, async (ctx) => {
            const existing = await this.findById(ctx, sec, { id: args.id });
            if (!existing) {
                return null;
            }

            const sub = iriFor("message", args.id);

            await this._store.delete(ctx, {
                subject: sub,
                predicate: isDeletedIRI,
                graph: CONVOS_GRAPH,
            });
            await this._store.insert(ctx, {
                subject: sub,
                predicate: isDeletedIRI,
                object: literal("true", XSD_BOOLEAN),
                graph: CONVOS_GRAPH,
            });

            return this.findById(ctx, sec, { id: args.id });
        });
    }

    /** @insecure @nochecks */
    async findRevisionsForMessage(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: MessageIdArgs,
    ): Promise<MessageRevisionEntity[]> {
        const quads = await this._store.find(ctx, {
            predicate: messageRefIRI,
            object: iriFor("message", args.messageId),
            graph: CONVOS_GRAPH,
        });

        const revisions: MessageRevisionEntity[] = [];

        for (const q of quads) {
            const revId = idFrom((q.subject as IRI).value);
            const all = await this._store.find(ctx, {
                subject: q.subject as IRI,
                graph: CONVOS_GRAPH,
            });
            if (all.length > 0) {
                revisions.push(this._revisionFromQuads(revId, all));
            }
        }

        revisions.sort((a, b) => a.revision - b.revision);
        return revisions;
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
    ): MessageEntity {
        const getLit = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? literalValue(q.object) : undefined;
        };
        const getIri = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? iriValue(q.object) : undefined;
        };

        const conversationIri = getIri(conversationRefIRI);
        if (conversationIri == null) {
            throw new Error(`MessageRepository: missing conversation for id "${id}"`);
        }
        const authorIriVal = getIri(authorIRI);
        if (authorIriVal == null) {
            throw new Error(`MessageRepository: missing author for id "${id}"`);
        }
        const content = getLit(contentIRI);
        if (content == null) {
            throw new Error(`MessageRepository: missing content for id "${id}"`);
        }
        const contentType = getLit(contentTypeIRI);
        if (contentType == null) {
            throw new Error(`MessageRepository: missing contentType for id "${id}"`);
        }

        const replyToIriVal = getIri(replyToIRI);
        const isDeletedStr = getLit(isDeletedIRI) ?? "false";
        const revCountStr = getLit(revisionCountIRI) ?? "0";

        return {
            id,
            iri: iriFor("message", id).value,
            conversationId: idFrom(conversationIri),
            replyToId: replyToIriVal ? idFrom(replyToIriVal) : null,
            authorId: authorIriVal,
            content,
            contentType: contentType as ContentType,
            isDeleted: isDeletedStr === "true",
            revisionCount: parseInt(revCountStr, 10),
            createdAt: ts.createdAt,
            updatedAt: ts.updatedAt,
        };
    }

    private _revisionFromQuads(
        id: string,
        quads: Awaited<ReturnType<TripleStore["find"]>>,
    ): MessageRevisionEntity {
        const getLit = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? literalValue(q.object) : undefined;
        };
        const getIri = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? iriValue(q.object) : undefined;
        };

        const messageIri = getIri(messageRefIRI);
        if (messageIri == null) {
            throw new Error(`MessageRepository: missing messageRef for revision "${id}"`);
        }
        const content = getLit(contentIRI) ?? "";
        const revStr = getLit(revisionIRI) ?? "0";
        const editorIri = getIri(editedByIRI) ?? "";
        const editedAtStr = getLit(editedAtIRI) ?? new Date().toISOString();

        return {
            id,
            iri: iriFor("revision", id).value,
            messageId: idFrom(messageIri),
            content,
            revision: parseInt(revStr, 10),
            editedBy: editorIri,
            editedAt: new Date(editedAtStr),
        };
    }
}
