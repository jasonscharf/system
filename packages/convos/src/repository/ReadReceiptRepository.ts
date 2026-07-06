import type { TripleStore } from "@jasonscharf/data";
import type { EntityRecord } from "@jasonscharf/entities";
import type { SecurityContext, ServerContext } from "@jasonscharf/server";
import { createEntityStore, EntityQuery, type EntityStore } from "@jasonscharf/server";
import { ReadReceiptSchema } from "../entities/ReadReceiptSchema.js";
import type { ReadReceiptEntity } from "../types.js";
import { idFrom, iriFor, newId } from "./util.js";

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

/**
 * Data-access layer for read-receipt watermarks.
 *
 * Repositories are the trusted persistence layer and perform NO access checks
 * by design — the same split TRN-203 established for the auth bounded context.
 * Authorization is enforced one level up, at the ConvoService boundary, which
 * asserts the relevant RBAC permission (PERM_CONVO_READ for receipt reads) or
 * gates on conversation membership before delegating here. The `sec` argument
 * is threaded through for signature symmetry and so a future row-level policy
 * could hook in, but is intentionally not consulted in this layer.
 */
export class ReadReceiptRepository {
    private readonly _store: TripleStore;
    private readonly _entities: EntityStore;

    constructor(store: TripleStore) {
        this._store = store;
        this._entities = createEntityStore(store);
    }

    get store(): TripleStore {
        return this._store;
    }

    /**
     * @dataLayer — no checks here; ConvoService enforces (see class doc).
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
                await this._entities.update(ctx, ReadReceiptSchema, existing.id, {
                    lastReadMessage: iriFor("message", args.lastReadMessageId).value,
                    lastReadAt: now,
                });
                return {
                    ...existing,
                    lastReadMessageId: args.lastReadMessageId,
                    lastReadAt: now,
                };
            }

            const record = await this._entities.create(
                ctx,
                ReadReceiptSchema,
                {
                    receiptConversation: iriFor("conversation", args.conversationId).value,
                    receiptUser: args.userId,
                    lastReadMessage: iriFor("message", args.lastReadMessageId).value,
                    lastReadAt: now,
                },
                newId(),
            );
            return this._toEntity(record);
        });
    }

    /** @dataLayer — no checks here; ConvoService enforces (see class doc). */
    async findByConversationAndUser(
        ctx: ServerContext,
        sec: SecurityContext,
        args: ConversationUserArgs,
    ): Promise<ReadReceiptEntity | null> {
        const all = await this.findByConversation(ctx, sec, {
            conversationId: args.conversationId,
        });
        return all.find((r) => r.userId === args.userId) ?? null;
    }

    /** @dataLayer — no checks here; ConvoService enforces (see class doc). */
    async findByConversation(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: ConversationIdArgs,
    ): Promise<ReadReceiptEntity[]> {
        const records = await EntityQuery.from(this._store, ReadReceiptSchema)
            .where("receiptConversation", "=", iriFor("conversation", args.conversationId).value)
            .all(ctx);
        return records.map((r) => this._toEntity(r));
    }

    private _toEntity(record: EntityRecord): ReadReceiptEntity {
        const conversation = record.props.receiptConversation;
        if (conversation == null) {
            throw new Error(`ReadReceiptRepository: missing conversation for id "${record.id}"`);
        }
        const user = record.props.receiptUser;
        if (user == null) {
            throw new Error(`ReadReceiptRepository: missing user for id "${record.id}"`);
        }
        const msg = record.props.lastReadMessage;
        if (msg == null) {
            throw new Error(`ReadReceiptRepository: missing lastReadMessage for id "${record.id}"`);
        }
        const lastReadAt = record.props.lastReadAt;
        if (lastReadAt == null) {
            throw new Error(`ReadReceiptRepository: missing lastReadAt for id "${record.id}"`);
        }

        return {
            id: record.id,
            iri: record.iri,
            conversationId: idFrom(String(conversation)),
            userId: String(user),
            lastReadMessageId: idFrom(String(msg)),
            lastReadAt: lastReadAt instanceof Date ? lastReadAt : new Date(String(lastReadAt)),
        };
    }
}
