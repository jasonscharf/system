import type { TripleStore } from "@jasonscharf/data";
import type { EntityRecord } from "@jasonscharf/entities";
import type { SecurityContext, ServerContext } from "@jasonscharf/server";
import { createEntityStore, EntityQuery, type EntityStore } from "@jasonscharf/server";
import { MessageRevisionSchema } from "../entities/MessageRevisionSchema.js";
import { MessageSchema } from "../entities/MessageSchema.js";
import type { ContentType, MessageEntity, MessageRevisionEntity } from "../types.js";
import { idFrom, iriFor, newId } from "./util.js";

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

/**
 * Data-access layer for Message entities and their revision history.
 *
 * Repositories are the trusted persistence layer and perform NO access checks
 * by design — the same split TRN-203 established for the auth bounded context.
 * Authorization is enforced one level up, at the ConvoService boundary, which
 * asserts PERM_MESSAGE_POST / edit / delete on writes and gates reads on
 * conversation membership / PERM_CONVO_READ before delegating here. The `sec`
 * argument is threaded through for signature symmetry and a possible future
 * row-level policy, but is intentionally not consulted in this layer.
 */
export class MessageRepository {
    private readonly _store: TripleStore;
    private readonly _entities: EntityStore;

    constructor(store: TripleStore) {
        this._store = store;
        this._entities = createEntityStore(store);
    }

    get store(): TripleStore {
        return this._store;
    }

    /** @dataLayer — no checks here; ConvoService enforces (see class doc). */
    async create(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: Pick<MessageEntity, "conversationId" | "authorId" | "content" | "contentType"> & {
            replyToId?: string;
        },
    ): Promise<MessageEntity> {
        const record = await this._entities.create(
            ctx,
            MessageSchema,
            {
                conversation: iriFor("conversation", args.conversationId).value,
                author: args.authorId,
                content: args.content,
                contentType: args.contentType,
                isDeleted: false,
                revisionCount: 0,
                replyTo: args.replyToId ? iriFor("message", args.replyToId).value : undefined,
            },
            newId(),
        );
        return this._toEntity(record);
    }

    /** @dataLayer — no checks here; ConvoService enforces (see class doc). */
    async findById(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: IdArgs,
    ): Promise<MessageEntity | null> {
        const record = await this._entities.findById(ctx, MessageSchema, args.id);
        return record ? this._toEntity(record) : null;
    }

    /** @dataLayer — no checks here; ConvoService enforces (see class doc). */
    async findByConversation(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: ConversationIdArgs,
    ): Promise<MessageEntity[]> {
        const records = await EntityQuery.from(this._store, MessageSchema)
            .where("conversation", "=", iriFor("conversation", args.conversationId).value)
            .all(ctx);
        const messages = records.map((r) => this._toEntity(r));
        // Primary order is creation time; tiebreak on id so equal-precision PG
        // timestamps still yield a single deterministic order (find() is unordered).
        messages.sort((a, b) => {
            const byTime = a.createdAt.getTime() - b.createdAt.getTime();
            if (byTime !== 0) {
                return byTime;
            }
            return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
        return messages;
    }

    /** @dataLayer — no checks here; ConvoService enforces (see class doc). */
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

            const now = new Date();
            const nextRevision = existing.revisionCount + 1;

            // Save a revision snapshot of the pre-edit content before overwriting.
            const revRecord = await this._entities.create(ctx, MessageRevisionSchema, {
                messageRef: iriFor("message", args.id).value,
                content: existing.content,
                revision: existing.revisionCount,
                editedBy: args.editorId,
                editedAt: now,
            });

            await this._entities.update(ctx, MessageSchema, args.id, {
                content: args.newContent,
                revisionCount: nextRevision,
            });

            const updated = await this.findById(ctx, sec, { id: args.id });
            if (!updated) {
                throw new Error(`MessageRepository: message ${args.id} vanished after edit`);
            }

            return {
                message: updated,
                revision: {
                    id: revRecord.id,
                    iri: revRecord.iri,
                    messageId: args.id,
                    content: existing.content,
                    revision: existing.revisionCount,
                    editedBy: args.editorId,
                    editedAt: now,
                },
            };
        });
    }

    /** @dataLayer — no checks here; ConvoService enforces (see class doc). */
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
            await this._entities.update(ctx, MessageSchema, args.id, { isDeleted: true });
            return this.findById(ctx, sec, { id: args.id });
        });
    }

    /** @dataLayer — no checks here; ConvoService enforces (see class doc). */
    async findRevisionsForMessage(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: MessageIdArgs,
    ): Promise<MessageRevisionEntity[]> {
        const records = await EntityQuery.from(this._store, MessageRevisionSchema)
            .where("messageRef", "=", iriFor("message", args.messageId).value)
            .all(ctx);
        const revisions = records.map((r) => this._revisionToEntity(r));
        revisions.sort((a, b) => a.revision - b.revision);
        return revisions;
    }

    private _toEntity(record: EntityRecord): MessageEntity {
        const conversation = record.props.conversation;
        if (conversation == null) {
            throw new Error(`MessageRepository: missing conversation for id "${record.id}"`);
        }
        const author = record.props.author;
        if (author == null) {
            throw new Error(`MessageRepository: missing author for id "${record.id}"`);
        }
        const content = record.props.content;
        if (content == null) {
            throw new Error(`MessageRepository: missing content for id "${record.id}"`);
        }
        const contentType = record.props.contentType;
        if (contentType == null) {
            throw new Error(`MessageRepository: missing contentType for id "${record.id}"`);
        }

        const replyTo = record.props.replyTo;

        return {
            id: record.id,
            iri: record.iri,
            conversationId: idFrom(String(conversation)),
            replyToId: replyTo != null ? idFrom(String(replyTo)) : null,
            authorId: String(author),
            content: String(content),
            contentType: String(contentType) as ContentType,
            isDeleted: record.props.isDeleted === true,
            revisionCount: Number(record.props.revisionCount ?? 0),
            createdAt: record.createdAt ?? new Date(),
            updatedAt: record.updatedAt ?? new Date(),
        };
    }

    private _revisionToEntity(record: EntityRecord): MessageRevisionEntity {
        const messageRef = record.props.messageRef;
        if (messageRef == null) {
            throw new Error(`MessageRepository: missing messageRef for revision "${record.id}"`);
        }
        const editedAt = record.props.editedAt;

        return {
            id: record.id,
            iri: record.iri,
            messageId: idFrom(String(messageRef)),
            content: String(record.props.content ?? ""),
            revision: Number(record.props.revision ?? 0),
            editedBy: String(record.props.editedBy ?? ""),
            editedAt:
                editedAt instanceof Date
                    ? editedAt
                    : new Date(editedAt != null ? String(editedAt) : Date.now()),
        };
    }
}
