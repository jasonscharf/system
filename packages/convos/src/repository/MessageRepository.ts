import { IRI, literal } from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { ServerContext } from "@jasonscharf/server";
import {
    authorIRI,
    CONVOS_GRAPH,
    contentIRI,
    contentTypeIRI,
    conversationRefIRI,
    convosCreatedAtIRI,
    convosUpdatedAtIRI,
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

export class MessageRepository {
    private readonly _store: TripleStore;

    constructor(store: TripleStore) {
        this._store = store;
    }

    async create(
        ctx: ServerContext,
        input: Pick<MessageEntity, "conversationId" | "authorId" | "content" | "contentType"> & {
            replyToId?: string;
        },
    ): Promise<MessageEntity> {
        const id = newId();
        const now = new Date();
        const sub = iriFor("message", id);

        const quads = [
            { subject: sub, predicate: RDF_TYPE, object: MessageClassIRI, graph: CONVOS_GRAPH },
            {
                subject: sub,
                predicate: conversationRefIRI,
                object: iriFor("conversation", input.conversationId),
                graph: CONVOS_GRAPH,
            },
            {
                subject: sub,
                predicate: authorIRI,
                object: new IRI(input.authorId),
                graph: CONVOS_GRAPH,
            },
            {
                subject: sub,
                predicate: contentIRI,
                object: literal(input.content, XSD_STRING),
                graph: CONVOS_GRAPH,
            },
            {
                subject: sub,
                predicate: contentTypeIRI,
                object: literal(input.contentType, XSD_STRING),
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
            {
                subject: sub,
                predicate: convosCreatedAtIRI,
                object: literal(now.toISOString(), XSD_DATETIME),
                graph: CONVOS_GRAPH,
            },
            {
                subject: sub,
                predicate: convosUpdatedAtIRI,
                object: literal(now.toISOString(), XSD_DATETIME),
                graph: CONVOS_GRAPH,
            },
        ];

        if (input.replyToId) {
            quads.push({
                subject: sub,
                predicate: replyToIRI,
                object: iriFor("message", input.replyToId),
                graph: CONVOS_GRAPH,
            });
        }

        await this._store.insertMany(ctx, quads);

        return {
            id,
            iri: sub.value,
            conversationId: input.conversationId,
            replyToId: input.replyToId ?? null,
            authorId: input.authorId,
            content: input.content,
            contentType: input.contentType,
            isDeleted: false,
            revisionCount: 0,
            createdAt: now,
            updatedAt: now,
        };
    }

    async findById(ctx: ServerContext, id: string): Promise<MessageEntity | null> {
        const sub = iriFor("message", id);
        const quads = await this._store.find(ctx, { subject: sub, graph: CONVOS_GRAPH });
        return quads.length === 0 ? null : this._fromQuads(id, quads);
    }

    async findByConversation(ctx: ServerContext, conversationId: string): Promise<MessageEntity[]> {
        const quads = await this._store.find(ctx, {
            predicate: conversationRefIRI,
            object: iriFor("conversation", conversationId),
            graph: CONVOS_GRAPH,
        });

        const messages: MessageEntity[] = [];

        for (const q of quads) {
            const subjIri = (q.subject as IRI).value;
            if (!subjIri.includes("/message/")) {
                continue;
            }
            const msgId = idFrom(subjIri);
            const all = await this._store.find(ctx, {
                subject: q.subject as IRI,
                graph: CONVOS_GRAPH,
            });
            if (all.length > 0) {
                messages.push(this._fromQuads(msgId, all));
            }
        }

        messages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return messages;
    }

    async edit(
        ctx: ServerContext,
        id: string,
        newContent: string,
        editorId: string,
    ): Promise<{ message: MessageEntity; revision: MessageRevisionEntity } | null> {
        const existing = await this.findById(ctx, id);
        if (!existing || existing.isDeleted) {
            return null;
        }

        const sub = iriFor("message", id);
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
                object: new IRI(editorId),
                graph: CONVOS_GRAPH,
            },
            {
                subject: revSub,
                predicate: editedAtIRI,
                object: literal(now.toISOString(), XSD_DATETIME),
                graph: CONVOS_GRAPH,
            },
        ]);

        // Update message content and revision count
        await this._store.delete(ctx, { subject: sub, predicate: contentIRI, graph: CONVOS_GRAPH });
        await this._store.insert(ctx, {
            subject: sub,
            predicate: contentIRI,
            object: literal(newContent, XSD_STRING),
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

        await this._store.delete(ctx, {
            subject: sub,
            predicate: convosUpdatedAtIRI,
            graph: CONVOS_GRAPH,
        });
        await this._store.insert(ctx, {
            subject: sub,
            predicate: convosUpdatedAtIRI,
            object: literal(now.toISOString(), XSD_DATETIME),
            graph: CONVOS_GRAPH,
        });

        const updated = await this.findById(ctx, id);
        if (!updated) {
            throw new Error(`MessageRepository: message ${id} vanished after edit`);
        }

        return {
            message: updated,
            revision: {
                id: revId,
                iri: revSub.value,
                messageId: id,
                content: existing.content,
                revision: existing.revisionCount,
                editedBy: editorId,
                editedAt: now,
            },
        };
    }

    async softDelete(ctx: ServerContext, id: string): Promise<MessageEntity | null> {
        const existing = await this.findById(ctx, id);
        if (!existing) {
            return null;
        }

        const sub = iriFor("message", id);
        const now = new Date();

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

        await this._store.delete(ctx, {
            subject: sub,
            predicate: convosUpdatedAtIRI,
            graph: CONVOS_GRAPH,
        });
        await this._store.insert(ctx, {
            subject: sub,
            predicate: convosUpdatedAtIRI,
            object: literal(now.toISOString(), XSD_DATETIME),
            graph: CONVOS_GRAPH,
        });

        return this.findById(ctx, id);
    }

    async findRevisionsForMessage(
        ctx: ServerContext,
        messageId: string,
    ): Promise<MessageRevisionEntity[]> {
        const quads = await this._store.find(ctx, {
            predicate: messageRefIRI,
            object: iriFor("message", messageId),
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

    private _fromQuads(id: string, quads: Awaited<ReturnType<TripleStore["find"]>>): MessageEntity {
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
        const createdAtStr = getLit(convosCreatedAtIRI);
        if (createdAtStr == null) {
            throw new Error(`MessageRepository: missing createdAt for id "${id}"`);
        }
        const updatedAtStr = getLit(convosUpdatedAtIRI);
        if (updatedAtStr == null) {
            throw new Error(`MessageRepository: missing updatedAt for id "${id}"`);
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
            createdAt: new Date(createdAtStr),
            updatedAt: new Date(updatedAtStr),
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
