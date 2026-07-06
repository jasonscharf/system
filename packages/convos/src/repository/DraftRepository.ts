import type { TripleStore } from "@jasonscharf/data";
import type { EntityRecord } from "@jasonscharf/entities";
import type { SecurityContext, ServerContext } from "@jasonscharf/server";
import { createEntityStore, EntityQuery, type EntityStore } from "@jasonscharf/server";
import { DraftSchema } from "../entities/DraftSchema.js";
import type { ContentType, DraftEntity } from "../types.js";
import { idFrom, iriFor, newId } from "./util.js";

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

/**
 * Data-access layer for message Draft entities.
 *
 * Repositories are the trusted persistence layer and perform NO access checks
 * by design — the same split TRN-203 established for the auth bounded context.
 * Authorization is enforced one level up, at the ConvoService boundary, which
 * asserts PERM_MESSAGE_POST when a draft is promoted to a message before
 * delegating here. The `sec` argument is threaded through for signature
 * symmetry and a possible future row-level policy, but is not consulted here.
 */
export class DraftRepository {
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
        args: Pick<DraftEntity, "conversationId" | "authorId" | "content" | "contentType"> & {
            replyToId?: string;
        },
    ): Promise<DraftEntity> {
        const record = await this._entities.create(
            ctx,
            DraftSchema,
            {
                conversation: iriFor("conversation", args.conversationId).value,
                author: args.authorId,
                content: args.content,
                contentType: args.contentType,
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
    ): Promise<DraftEntity | null> {
        const record = await this._entities.findById(ctx, DraftSchema, args.id);
        return record ? this._toEntity(record) : null;
    }

    /** @dataLayer — no checks here; ConvoService enforces (see class doc). */
    async findByAuthor(
        ctx: ServerContext,
        _sec: SecurityContext,
        args: AuthorIdArgs,
    ): Promise<DraftEntity[]> {
        const records = await EntityQuery.from(this._store, DraftSchema)
            .where("author", "=", args.authorId)
            .all(ctx);
        return records.map((r) => this._toEntity(r));
    }

    /** @dataLayer — no checks here; ConvoService enforces (see class doc). */
    async findByAuthorAndConversation(
        ctx: ServerContext,
        sec: SecurityContext,
        args: AuthorConversationArgs,
    ): Promise<DraftEntity[]> {
        const all = await this.findByAuthor(ctx, sec, { authorId: args.authorId });
        return all.filter((d) => d.conversationId === args.conversationId);
    }

    /** @dataLayer — no checks here; ConvoService enforces (see class doc). */
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
            await this._entities.update(ctx, DraftSchema, args.id, { content: args.content });
            return this.findById(ctx, sec, { id: args.id });
        });
    }

    /** @dataLayer — no checks here; ConvoService enforces (see class doc). */
    async delete(ctx: ServerContext, _sec: SecurityContext, args: IdArgs): Promise<void> {
        await this._entities.delete(ctx, DraftSchema, args.id);
    }

    private _toEntity(record: EntityRecord): DraftEntity {
        const conversation = record.props.conversation;
        if (conversation == null) {
            throw new Error(`DraftRepository: missing conversation for id "${record.id}"`);
        }
        const author = record.props.author;
        if (author == null) {
            throw new Error(`DraftRepository: missing author for id "${record.id}"`);
        }

        const replyTo = record.props.replyTo;

        return {
            id: record.id,
            iri: record.iri,
            conversationId: idFrom(String(conversation)),
            authorId: String(author),
            replyToId: replyTo != null ? idFrom(String(replyTo)) : null,
            content: String(record.props.content ?? ""),
            contentType: String(record.props.contentType ?? "text/markdown") as ContentType,
            createdAt: record.createdAt ?? new Date(),
            updatedAt: record.updatedAt ?? new Date(),
        };
    }
}
