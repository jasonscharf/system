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
    DraftClassIRI,
    RDF_TYPE,
    replyToIRI,
    XSD_DATETIME,
    XSD_STRING,
} from "../constants.js";
import type { ContentType, DraftEntity } from "../types.js";
import { idFrom, iriFor, iriValue, literalValue, newId } from "./util.js";

export class DraftRepository {
    private readonly _store: TripleStore;

    constructor(store: TripleStore) {
        this._store = store;
    }

    async create(
        ctx: ServerContext,
        input: Pick<DraftEntity, "conversationId" | "authorId" | "content" | "contentType"> & {
            replyToId?: string;
        },
    ): Promise<DraftEntity> {
        const id = newId();
        const now = new Date();
        const sub = iriFor("draft", id);

        const quads = [
            { subject: sub, predicate: RDF_TYPE, object: DraftClassIRI, graph: CONVOS_GRAPH },
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
            authorId: input.authorId,
            replyToId: input.replyToId ?? null,
            content: input.content,
            contentType: input.contentType,
            createdAt: now,
            updatedAt: now,
        };
    }

    async findById(ctx: ServerContext, id: string): Promise<DraftEntity | null> {
        const sub = iriFor("draft", id);
        const quads = await this._store.find(ctx, { subject: sub, graph: CONVOS_GRAPH });
        return quads.length === 0 ? null : this._fromQuads(id, quads);
    }

    async findByAuthor(ctx: ServerContext, authorId: string): Promise<DraftEntity[]> {
        const quads = await this._store.find(ctx, {
            predicate: authorIRI,
            object: new IRI(authorId),
            graph: CONVOS_GRAPH,
        });

        const drafts: DraftEntity[] = [];

        for (const q of quads) {
            const subjIri = (q.subject as IRI).value;
            if (!subjIri.includes("/draft/")) {
                continue;
            }
            const draftId = idFrom(subjIri);
            const all = await this._store.find(ctx, {
                subject: q.subject as IRI,
                graph: CONVOS_GRAPH,
            });
            if (all.length > 0) {
                drafts.push(this._fromQuads(draftId, all));
            }
        }

        return drafts;
    }

    async findByAuthorAndConversation(
        ctx: ServerContext,
        authorId: string,
        conversationId: string,
    ): Promise<DraftEntity[]> {
        const all = await this.findByAuthor(ctx, authorId);
        return all.filter((d) => d.conversationId === conversationId);
    }

    async update(
        ctx: ServerContext,
        id: string,
        content: string,
    ): Promise<DraftEntity | null> {
        const existing = await this.findById(ctx, id);
        if (!existing) {
            return null;
        }

        const sub = iriFor("draft", id);
        const now = new Date();

        await this._store.delete(ctx, { subject: sub, predicate: contentIRI, graph: CONVOS_GRAPH });
        await this._store.insert(ctx, {
            subject: sub,
            predicate: contentIRI,
            object: literal(content, XSD_STRING),
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

    async delete(ctx: ServerContext, id: string): Promise<void> {
        await this._store.delete(ctx, { subject: iriFor("draft", id), graph: CONVOS_GRAPH });
    }

    private _fromQuads(
        id: string,
        quads: Awaited<ReturnType<TripleStore["find"]>>,
    ): DraftEntity {
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
            throw new Error(`DraftRepository: missing conversation for id "${id}"`);
        }
        const authorIriVal = getIri(authorIRI);
        if (authorIriVal == null) {
            throw new Error(`DraftRepository: missing author for id "${id}"`);
        }
        const content = getLit(contentIRI) ?? "";
        const contentType = getLit(contentTypeIRI) ?? "text/markdown";
        const createdAtStr = getLit(convosCreatedAtIRI);
        if (createdAtStr == null) {
            throw new Error(`DraftRepository: missing createdAt for id "${id}"`);
        }
        const updatedAtStr = getLit(convosUpdatedAtIRI);
        if (updatedAtStr == null) {
            throw new Error(`DraftRepository: missing updatedAt for id "${id}"`);
        }

        const replyToIriVal = getIri(replyToIRI);

        return {
            id,
            iri: iriFor("draft", id).value,
            conversationId: idFrom(conversationIri),
            authorId: authorIriVal,
            replyToId: replyToIriVal ? idFrom(replyToIriVal) : null,
            content,
            contentType: contentType as ContentType,
            createdAt: new Date(createdAtStr),
            updatedAt: new Date(updatedAtStr),
        };
    }
}
