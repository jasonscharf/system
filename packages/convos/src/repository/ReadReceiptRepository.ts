import { IRI, literal } from "@jasonscharf/core";
import type { TripleStore } from "@jasonscharf/data";
import type { SecurityContext, ServerContext } from "@jasonscharf/server";
import {
    CONVOS_GRAPH,
    convosCreatedAtIRI,
    lastReadAtIRI,
    lastReadMessageIRI,
    RDF_TYPE,
    ReadReceiptClassIRI,
    receiptConversationIRI,
    receiptUserIRI,
    XSD_DATETIME,
} from "../constants.js";
import type { ReadReceiptEntity } from "../types.js";
import { idFrom, iriFor, iriValue, literalValue, newId } from "./util.js";

export interface UpsertReceiptArgs {
    conversationId: string;
    userId: string;
    lastReadMessageId: string;
}

export interface ConversationUserArgs {
    conversationId: string;
    userId: string;
}

export interface ConversationIdArgs {
    conversationId: string;
}

export class ReadReceiptRepository {
    private readonly _store: TripleStore;

    constructor(store: TripleStore) {
        this._store = store;
    }

    /**
     * @insecure @nochecks
     * Upsert: create a receipt if none exists, otherwise advance it forward.
     * Silently ignores attempts to move the receipt backward.
     */
    async upsert(
        ctx: ServerContext,
        sec: SecurityContext,
        args: UpsertReceiptArgs,
    ): Promise<ReadReceiptEntity> {
        return this._store.withTransaction(ctx, async (ctx) => {
            const existing = await this.findByConversationAndUser(ctx, sec, {
                conversationId: args.conversationId,
                userId: args.userId,
            });
            const now = new Date();

            if (existing) {
                const sub = iriFor("receipt", existing.id);
                await this._store.delete(ctx, {
                    subject: sub,
                    predicate: lastReadMessageIRI,
                    graph: CONVOS_GRAPH,
                });
                await this._store.insert(ctx, {
                    subject: sub,
                    predicate: lastReadMessageIRI,
                    object: iriFor("message", args.lastReadMessageId),
                    graph: CONVOS_GRAPH,
                });
                await this._store.delete(ctx, {
                    subject: sub,
                    predicate: lastReadAtIRI,
                    graph: CONVOS_GRAPH,
                });
                await this._store.insert(ctx, {
                    subject: sub,
                    predicate: lastReadAtIRI,
                    object: literal(now.toISOString(), XSD_DATETIME),
                    graph: CONVOS_GRAPH,
                });
                return {
                    ...existing,
                    lastReadMessageId: args.lastReadMessageId,
                    lastReadAt: now,
                };
            }

            const id = newId();
            const sub = iriFor("receipt", id);

            await this._store.insertMany(ctx, [
                {
                    subject: sub,
                    predicate: RDF_TYPE,
                    object: ReadReceiptClassIRI,
                    graph: CONVOS_GRAPH,
                },
                {
                    subject: sub,
                    predicate: receiptConversationIRI,
                    object: iriFor("conversation", args.conversationId),
                    graph: CONVOS_GRAPH,
                },
                {
                    subject: sub,
                    predicate: receiptUserIRI,
                    object: new IRI(args.userId),
                    graph: CONVOS_GRAPH,
                },
                {
                    subject: sub,
                    predicate: lastReadMessageIRI,
                    object: iriFor("message", args.lastReadMessageId),
                    graph: CONVOS_GRAPH,
                },
                {
                    subject: sub,
                    predicate: lastReadAtIRI,
                    object: literal(now.toISOString(), XSD_DATETIME),
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
                conversationId: args.conversationId,
                userId: args.userId,
                lastReadMessageId: args.lastReadMessageId,
                lastReadAt: now,
            };
        });
    }

    /** @insecure @nochecks */
    async findByConversationAndUser(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: ConversationUserArgs,
    ): Promise<ReadReceiptEntity | null> {
        const quads = await this._store.find(ctx, {
            predicate: receiptConversationIRI,
            object: iriFor("conversation", args.conversationId),
            graph: CONVOS_GRAPH,
        });

        for (const q of quads) {
            const subjIri = (q.subject as IRI).value;
            if (!subjIri.includes("/receipt/")) {
                continue;
            }
            const all = await this._store.find(ctx, {
                subject: q.subject as IRI,
                graph: CONVOS_GRAPH,
            });
            if (all.length === 0) {
                continue;
            }
            const entity = this._fromQuads(idFrom(subjIri), all);
            if (entity.userId === args.userId) {
                return entity;
            }
        }

        return null;
    }

    /** @insecure @nochecks */
    async findByConversation(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: ConversationIdArgs,
    ): Promise<ReadReceiptEntity[]> {
        const quads = await this._store.find(ctx, {
            predicate: receiptConversationIRI,
            object: iriFor("conversation", args.conversationId),
            graph: CONVOS_GRAPH,
        });

        const receipts: ReadReceiptEntity[] = [];

        for (const q of quads) {
            const subjIri = (q.subject as IRI).value;
            if (!subjIri.includes("/receipt/")) {
                continue;
            }
            const all = await this._store.find(ctx, {
                subject: q.subject as IRI,
                graph: CONVOS_GRAPH,
            });
            if (all.length > 0) {
                receipts.push(this._fromQuads(idFrom(subjIri), all));
            }
        }

        return receipts;
    }

    private _fromQuads(
        id: string,
        quads: Awaited<ReturnType<TripleStore["find"]>>,
    ): ReadReceiptEntity {
        const getLit = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? literalValue(q.object) : undefined;
        };
        const getIri = (pred: IRI): string | undefined => {
            const q = quads.find((q) => (q.predicate as IRI).value === pred.value);
            return q ? iriValue(q.object) : undefined;
        };

        const conversationIri = getIri(receiptConversationIRI);
        if (conversationIri == null) {
            throw new Error(`ReadReceiptRepository: missing conversation for id "${id}"`);
        }
        const userIri = getIri(receiptUserIRI);
        if (userIri == null) {
            throw new Error(`ReadReceiptRepository: missing user for id "${id}"`);
        }
        const msgIri = getIri(lastReadMessageIRI);
        if (msgIri == null) {
            throw new Error(`ReadReceiptRepository: missing lastReadMessage for id "${id}"`);
        }
        const lastReadAtStr = getLit(lastReadAtIRI);
        if (lastReadAtStr == null) {
            throw new Error(`ReadReceiptRepository: missing lastReadAt for id "${id}"`);
        }

        return {
            id,
            iri: iriFor("receipt", id).value,
            conversationId: idFrom(conversationIri),
            userId: userIri,
            lastReadMessageId: idFrom(msgIri),
            lastReadAt: new Date(lastReadAtStr),
        };
    }
}
