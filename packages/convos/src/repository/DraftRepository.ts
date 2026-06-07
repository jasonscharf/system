import { IRI, literal } from "@jasonscharf/core";
import type { EntityTimestamps, TripleStore } from "@jasonscharf/data";
import type { SecurityContext, ServerContext } from "@jasonscharf/server";
import {
    authorIRI,
    CONVOS_GRAPH,
    contentIRI,
    contentTypeIRI,
    conversationRefIRI,
    DraftClassIRI,
    RDF_TYPE,
    replyToIRI,
    XSD_STRING,
} from "../constants.js";
import type { ContentType, DraftEntity } from "../types.js";
import { idFrom, iriFor, iriValue, literalValue, newId } from "./util.js";

export interface IdArgs {
    id: string;
}

export interface AuthorIdArgs {
    authorId: string;
}

export interface AuthorConversationArgs {
    authorId: string;
    conversationId: string;
}

export interface UpdateDraftArgs {
    id: string;
    content: string;
}

export class DraftRepository {
    private readonly _store: TripleStore;

    constructor(store: TripleStore) {
        this._store = store;
    }

    /** @insecure @nochecks */
    async create(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: Pick<DraftEntity, "conversationId" | "authorId" | "content" | "contentType"> & {
            replyToId?: string;
        },
    ): Promise<DraftEntity> {
        const id = newId();
        const sub = iriFor("draft", id);

        return this._store.withTransaction(ctx, async (ctx) => {
            const quads = [
                { subject: sub, predicate: RDF_TYPE, object: DraftClassIRI, graph: CONVOS_GRAPH },
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
                authorId: args.authorId,
                replyToId: args.replyToId ?? null,
                content: args.content,
                contentType: args.contentType,
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
    ): Promise<DraftEntity | null> {
        const sub = iriFor("draft", args.id);
        const quads = await this._store.find(ctx, { subject: sub, graph: CONVOS_GRAPH });
        return quads.length === 0
            ? null
            : this._fromQuads(args.id, quads, await this._timestamps(ctx, sub));
    }

    /** @insecure @nochecks */
    async findByAuthor(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: AuthorIdArgs,
    ): Promise<DraftEntity[]> {
        const quads = await this._store.find(ctx, {
            predicate: authorIRI,
            object: new IRI(args.authorId),
            graph: CONVOS_GRAPH,
        });

        const drafts: DraftEntity[] = [];

        for (const q of quads) {
            const subjIri = (q.subject as IRI).value;
            if (!subjIri.includes(":draft:")) {
                continue;
            }
            const draftId = idFrom(subjIri);
            const all = await this._store.find(ctx, {
                subject: q.subject as IRI,
                graph: CONVOS_GRAPH,
            });
            if (all.length > 0) {
                drafts.push(
                    this._fromQuads(draftId, all, await this._timestamps(ctx, q.subject as IRI)),
                );
            }
        }

        return drafts;
    }

    /** @insecure @nochecks */
    async findByAuthorAndConversation(
        ctx: ServerContext,
        sec: SecurityContext,
        args: AuthorConversationArgs,
    ): Promise<DraftEntity[]> {
        const all = await this.findByAuthor(ctx, sec, { authorId: args.authorId });
        return all.filter((d) => d.conversationId === args.conversationId);
    }

    /** @insecure @nochecks */
    async update(
        ctx: ServerContext,
        sec: SecurityContext,
        args: UpdateDraftArgs,
    ): Promise<DraftEntity | null> {
        return this._store.withTransaction(ctx, async (ctx) => {
            const existing = await this.findById(ctx, sec, { id: args.id });
            if (!existing) {
                return null;
            }

            const sub = iriFor("draft", args.id);

            await this._store.delete(ctx, {
                subject: sub,
                predicate: contentIRI,
                graph: CONVOS_GRAPH,
            });
            await this._store.insert(ctx, {
                subject: sub,
                predicate: contentIRI,
                object: literal(args.content, XSD_STRING),
                graph: CONVOS_GRAPH,
            });

            return this.findById(ctx, sec, { id: args.id });
        });
    }

    /** @insecure @nochecks */
    async delete(ctx: ServerContext, _sec: SecurityContext, args: IdArgs): Promise<void> {
        await this._store.delete(ctx, { subject: iriFor("draft", args.id), graph: CONVOS_GRAPH });
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

        const replyToIriVal = getIri(replyToIRI);

        return {
            id,
            iri: iriFor("draft", id).value,
            conversationId: idFrom(conversationIri),
            authorId: authorIriVal,
            replyToId: replyToIriVal ? idFrom(replyToIriVal) : null,
            content,
            contentType: contentType as ContentType,
            createdAt: ts.createdAt,
            updatedAt: ts.updatedAt,
        };
    }
}
